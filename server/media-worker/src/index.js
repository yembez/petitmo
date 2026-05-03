const express = require('express');
const { z } = require('zod');
const { createClient } = require('@supabase/supabase-js');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

ffmpeg.setFfmpegPath(ffmpegPath);

const PORT = Number.parseInt(process.env.PORT || '8788', 10);
const SECRET = (process.env.MEDIA_WORKER_SECRET || '').trim();
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  // eslint-disable-next-line no-console
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (!SECRET) {
  // eslint-disable-next-line no-console
  console.error('Missing MEDIA_WORKER_SECRET');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const app = express();
app.use(express.json({ limit: '2mb' }));

function requireSecret(req, res) {
  const got = (req.header('X-Worker-Secret') || '').trim();
  if (got !== SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

const WORKER_MEDIA_SIGNED_SEC = Number.parseInt(process.env.MEDIA_WORKER_SIGNED_URL_SEC || '', 10) || 60 * 60 * 24 * 30;

async function signedUrlFor(bucket, objectPath) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(objectPath, WORKER_MEDIA_SIGNED_SEC);
  if (error || !data?.signedUrl) throw error || new Error('createSignedUrl failed');
  return data.signedUrl;
}

async function downloadToBuffer(bucket, objectPath) {
  const { data, error } = await supabase.storage.from(bucket).download(objectPath);
  if (error) throw error;
  const ab = await data.arrayBuffer();
  return Buffer.from(ab);
}

async function uploadBuffer(bucket, objectPath, buf, contentType, upsert = true) {
  const { error } = await supabase.storage.from(bucket).upload(objectPath, buf, {
    contentType,
    upsert,
  });
  if (error) throw error;
}

async function makeJpegVariant(buf, maxSide, quality) {
  return sharp(buf)
    .rotate() // respecte EXIF orientation
    .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}

function looksLikeHeifError(err) {
  const msg = String(err?.message || err || '');
  return /heif|heic|Support for this compression format has not been built in/i.test(msg);
}

function isHeicExt(ext) {
  const e = String(ext || '').toLowerCase();
  return e === 'heic' || e === 'heif';
}

/** Décodage HEIC portable (Linux/Docker/macOS) — avant ffmpeg/sips. */
async function tryHeicConvertToJpeg(buf) {
  try {
    const mod = await import('heic-convert');
    const convert = mod.default ?? mod;
    if (typeof convert !== 'function') return null;
    const out = await convert({ buffer: buf, format: 'JPEG', quality: 0.92 });
    if (!out) return null;
    return Buffer.isBuffer(out) ? out : Buffer.from(out);
  } catch {
    return null;
  }
}

async function convertHeicLikeToJpeg(buf, inputExtHint = 'bin') {
  const fromLib = await tryHeicConvertToJpeg(buf);
  if (fromLib && fromLib.length > 0) return fromLib;

  // Fallback: ffmpeg (si build avec décodeur HEIC) puis sips sur macOS dev.
  const safeExt = String(inputExtHint || 'bin').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
  const tmpIn = path.join(os.tmpdir(), `petitmo-img-${Date.now()}-${Math.random().toString(16).slice(2)}.${safeExt}`);
  const tmpOut = path.join(os.tmpdir(), `petitmo-img-${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`);
  try {
    await fs.writeFile(tmpIn, buf);
    try {
      await new Promise((resolve, reject) => {
        ffmpeg(tmpIn)
          .outputOptions(['-frames:v 1'])
          .output(tmpOut)
          .on('end', resolve)
          .on('error', reject)
          .run();
      });
      return await fs.readFile(tmpOut);
    } catch {
      if (process.platform === 'darwin') {
        await execFileAsync('sips', ['-s', 'format', 'jpeg', tmpIn, '--out', tmpOut]);
        return await fs.readFile(tmpOut);
      }
      throw new Error('HEIC/HEIF: heic-convert et ffmpeg ont échoué (installez les deps ou utilisez sips sur macOS)');
    }
  } finally {
    await fs.rm(tmpIn, { force: true }).catch(() => {});
    await fs.rm(tmpOut, { force: true }).catch(() => {});
  }
}

async function makeJpegVariantRobust(buf, maxSide, quality, inputExtHint) {
  const ext = String(inputExtHint || '').toLowerCase();
  if (isHeicExt(ext)) {
    const jpegBuf = await convertHeicLikeToJpeg(buf, ext);
    return await makeJpegVariant(jpegBuf, maxSide, quality);
  }
  try {
    return await makeJpegVariant(buf, maxSide, quality);
  } catch (e) {
    const msg = String(e?.message || e || '');
    const unsupported = /unsupported image format|Input buffer contains/i.test(msg);
    if (looksLikeHeifError(e) || unsupported) {
      const jpegBuf = await convertHeicLikeToJpeg(buf, ext);
      return await makeJpegVariant(jpegBuf, maxSide, quality);
    }
    throw e;
  }
}

async function overlayInkFromBottomRight(buf) {
  const img = sharp(buf);
  const meta = await img.metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  if (!w || !h) return '#FFFFFF';

  // Patch bas-droite (zone où on affiche l'overlay), ~22% largeur, ~18% hauteur
  const pw = Math.max(12, Math.round(w * 0.22));
  const ph = Math.max(12, Math.round(h * 0.18));
  const left = Math.max(0, w - pw);
  const top = Math.max(0, h - ph);

  const stats = await img.extract({ left, top, width: pw, height: ph }).stats();
  const r = stats.channels[0]?.mean ?? 255;
  const g = stats.channels[1]?.mean ?? 255;
  const b = stats.channels[2]?.mean ?? 255;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  // Seuil conservateur: on ne met du noir que si le patch est VRAIMENT clair,
  // sinon on force blanc (évite noir sur fond foncé).
  return luminance >= 0.78 ? '#0A0A0A' : '#FFFFFF';
}

async function extractVideoPosterToJpeg(tmpVideoPath, tmpPosterPath) {
  await new Promise((resolve, reject) => {
    ffmpeg(tmpVideoPath)
      .outputOptions(['-frames:v 1'])
      .output(tmpPosterPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

app.post('/process-memory', async (req, res) => {
  if (!requireSecret(req, res)) return;

  const schema = z.object({ memoryId: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid body' });

  const { memoryId } = parsed.data;

  try {
    const { data: m, error } = await supabase
      .from('memories')
      .select(
        'id,type,user_id,child_id,media_path,extra_photo_paths,voice_cover_path,thumbnail_path,thumb_url,display_url,print_url,poster_url,poster_print_url,captured_overlay_ink'
      )
      .eq('id', memoryId)
      .maybeSingle();
    if (error) throw error;
    if (!m) return res.status(404).json({ error: 'Memory not found' });

    const bucket = 'media';
    const baseDir = `${m.user_id}/${m.child_id}/derived/${m.id}`;

    if (m.type === 'photo') {
      const mainPath = m.media_path;
      if (!mainPath) return res.status(200).json({ ok: true, skipped: 'no media_path' });

      const src = await downloadToBuffer(bucket, mainPath);
      const mainExt = (path.extname(mainPath).slice(1) || 'bin').toLowerCase();
      const thumbBuf = await makeJpegVariantRobust(src, 600, 76, mainExt);
      const displayBuf = await makeJpegVariantRobust(src, 1600, 84, mainExt);
      const printBuf = await makeJpegVariantRobust(src, 2400, 88, mainExt);
      const capturedOverlayInk = await overlayInkFromBottomRight(thumbBuf);

      const thumbPath = `${baseDir}/thumb.jpg`;
      const displayPath = `${baseDir}/display.jpg`;
      const printPath = `${baseDir}/print.jpg`;

      await uploadBuffer(bucket, thumbPath, thumbBuf, 'image/jpeg', true);
      await uploadBuffer(bucket, displayPath, displayBuf, 'image/jpeg', true);
      await uploadBuffer(bucket, printPath, printBuf, 'image/jpeg', true);

      const [thumbUrl, displayUrl, printUrl] = await Promise.all([
        signedUrlFor(bucket, thumbPath),
        signedUrlFor(bucket, displayPath),
        signedUrlFor(bucket, printPath),
      ]);

      // Albums: on génère aussi des variantes pour chaque extra_photo_paths
      const extras = Array.isArray(m.extra_photo_paths) ? m.extra_photo_paths.filter(Boolean) : [];
      const extraThumbUrls = [];
      const extraDisplayUrls = [];

      for (let i = 0; i < extras.length; i++) {
        const p = String(extras[i] || '').trim();
        if (!p) continue;
        const b = await downloadToBuffer(bucket, p);
        const ext = (path.extname(p).slice(1) || 'bin').toLowerCase();
        const tb = await makeJpegVariantRobust(b, 600, 76, ext);
        const db = await makeJpegVariantRobust(b, 1600, 84, ext);
        const tPath = `${baseDir}/extra_${i + 1}_thumb.jpg`;
        const dPath = `${baseDir}/extra_${i + 1}_display.jpg`;
        await uploadBuffer(bucket, tPath, tb, 'image/jpeg', true);
        await uploadBuffer(bucket, dPath, db, 'image/jpeg', true);
        extraThumbUrls.push(await signedUrlFor(bucket, tPath));
        extraDisplayUrls.push(await signedUrlFor(bucket, dPath));
      }

      const { error: upErr } = await supabase
        .from('memories')
        .update({
          thumb_url: thumbUrl,
          display_url: displayUrl,
          print_url: printUrl,
          captured_overlay_ink: capturedOverlayInk,
          extra_thumb_urls: extraThumbUrls,
          extra_display_urls: extraDisplayUrls,
          updated_at: new Date().toISOString(),
        })
        .eq('id', m.id);
      if (upErr) throw upErr;

      return res.json({ ok: true, type: 'photo' });
    }

    if (m.type === 'video') {
      const mainPath = m.media_path;
      if (!mainPath) return res.status(200).json({ ok: true, skipped: 'no media_path' });

      // Téléchargement unique côté serveur (une fois), extraction d'un poster.
      const tmpVideo = path.join(os.tmpdir(), `petitmo-${m.id}-${Date.now()}.mp4`);
      const tmpPoster = path.join(os.tmpdir(), `petitmo-${m.id}-${Date.now()}.jpg`);

      try {
        const videoBuf = await downloadToBuffer(bucket, mainPath);
        await fs.writeFile(tmpVideo, videoBuf);
        await extractVideoPosterToJpeg(tmpVideo, tmpPoster);

        const posterBuf = await fs.readFile(tmpPoster);
        // 2 posters: léger pour app, HD pour impression.
        const posterSmall = await makeJpegVariant(posterBuf, 800, 82);
        const posterPrint = await makeJpegVariant(posterBuf, 2400, 88);
        const capturedOverlayInk = await overlayInkFromBottomRight(posterSmall);

        const posterPath = `${baseDir}/poster.jpg`;
        const posterPrintPath = `${baseDir}/poster_print.jpg`;
        await uploadBuffer(bucket, posterPath, posterSmall, 'image/jpeg', true);
        await uploadBuffer(bucket, posterPrintPath, posterPrint, 'image/jpeg', true);

        const [posterUrl, posterPrintUrl] = await Promise.all([
          signedUrlFor(bucket, posterPath),
          signedUrlFor(bucket, posterPrintPath),
        ]);

        const { error: upErr } = await supabase
          .from('memories')
          .update({
            poster_url: posterUrl,
            poster_print_url: posterPrintUrl,
            thumbnail_url: posterUrl,
            thumbnail_path: posterPath,
            captured_overlay_ink: capturedOverlayInk,
            updated_at: new Date().toISOString(),
          })
          .eq('id', m.id);
        if (upErr) throw upErr;

        return res.json({ ok: true, type: 'video' });
      } finally {
        await fs.rm(tmpVideo, { force: true }).catch(() => {});
        await fs.rm(tmpPoster, { force: true }).catch(() => {});
      }
    }

    // voice / text: rien à faire pour l’instant (on peut ajouter cover variants ensuite)
    return res.json({ ok: true, type: m.type, skipped: true });
  } catch (e) {
    const toPlain = (err) => {
      if (!err) return { message: 'Unknown error' };
      if (typeof err === 'string') return { message: err };
      if (err instanceof Error) return { message: err.message, name: err.name, stack: err.stack };
      try {
        return JSON.parse(JSON.stringify(err));
      } catch {
        return { message: String(err) };
      }
    };
    const plain = toPlain(e);
    // eslint-disable-next-line no-console
    console.error('[process-memory] failed', plain);
    return res.status(500).json({ error: plain });
  }
});

app.post('/delete-memory-assets', async (req, res) => {
  if (!requireSecret(req, res)) return;

  const schema = z.object({ memoryId: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid body' });

  const { memoryId } = parsed.data;

  try {
    // Memory row can be missing (already deleted). We still try to delete derived folder if we can.
    const { data: m } = await supabase
      .from('memories')
      .select('id,user_id,child_id,media_path,extra_photo_paths,voice_cover_path,thumbnail_path')
      .eq('id', memoryId)
      .maybeSingle();

    const bucket = 'media';
    const toRemove = [];

    if (m) {
      if (m.media_path) toRemove.push(m.media_path);
      if (m.voice_cover_path) toRemove.push(m.voice_cover_path);
      if (m.thumbnail_path) toRemove.push(m.thumbnail_path);
      if (Array.isArray(m.extra_photo_paths)) {
        for (const p of m.extra_photo_paths) {
          if (typeof p === 'string' && p.trim()) toRemove.push(p.trim());
        }
      }

      // Remove derived files by listing the derived folder
      const prefix = `${m.user_id}/${m.child_id}/derived/${memoryId}`;
      const { data: listData } = await supabase.storage.from(bucket).list(prefix, { limit: 200 });
      if (Array.isArray(listData)) {
        for (const obj of listData) {
          if (obj?.name) toRemove.push(`${prefix}/${obj.name}`);
        }
      }
    }

    if (toRemove.length) {
      const uniq = [...new Set(toRemove)];
      const { error: rmErr } = await supabase.storage.from(bucket).remove(uniq);
      if (rmErr) throw rmErr;
    }

    return res.json({ ok: true, removed: toRemove.length });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[delete-memory-assets] failed', e);
    return res.status(500).json({ error: String(e) });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[media-worker] listening on :${PORT}`);
});

