# AAF Cleaner — Réponses aux Threads Actifs

---

## 1. TalkBass — "Importing AAF files into Logic - kill me now"
🔗 https://www.talkbass.com/threads/importing-aaf-files-into-logic-kill-me-now.1647008/
**Ton :** Empathique, humor léger, solution directe.

> Ha, that thread title says it all.
>
> Logic's AAF support is genuinely broken — it's not you. The format was co-developed by Avid so Pro Tools handles it natively, and everyone else is basically patching around it.
>
> The usual workaround is bouncing through Pro Tools first, but I got tired of needing a PT license just for that one step, so I built a small tool to handle it: **aafcleaner.com**. Drop in the AAF, it re-links the audio and outputs something Logic actually opens cleanly.
>
> Free during beta if you want to try it on your session.

---

## 2. Gearspace — "Problems importing AAF into Logic X from Avid MC"
🔗 https://gearspace.com/board/post-production-forum/876509-problems-importing-aaf-into-logic-x-avid-mc.html
**Ton :** Technique, sobre. Gearspace déteste le marketing.

> Avid MC AAF into Logic is one of the messiest combos out there — Avid writes non-standard metadata that Logic just ignores or chokes on.
>
> The cleanest fix I've found is cleaning the AAF before Logic even sees it: strip the Avid-specific metadata, re-link the media, and re-output a minimal AAF that Logic can parse. I built a small tool to do exactly that — **aafcleaner.com** — still in beta but handles Premiere exports well. Avid MC is next on my test list, so if you still have the session, I'd genuinely love to test it against your file.

---

## 3. Creative COW — "AAF from Premiere Pro to Logic Pro X"
🔗 https://creativecow.net/forums/thread/aaf-from-premiere-pro-to-logic-pro-x/
**Ton :** Pratique, solution-oriented. Creative COW est une communauté pro.

> Premiere → Logic via AAF is the workflow I personally deal with most, and it's been frustrating for years.
>
> What works: Premiere exports a reasonably clean AAF, but Logic's importer is picky about media paths and embedded metadata. The trick is cleaning the AAF before import — re-linking the audio files and stripping unnecessary data.
>
> I ended up building a tool for this: **aafcleaner.com**. It's in public beta, specifically tested on Premiere Pro exports, and outputs either a clean AAF or a Reaper .RPP with handles. Might save you the Pro Tools round-trip.

---

## 4. LogicProHelp — "Logic Pro X - Importing OMF & AAF files"
🔗 https://www.logicprohelp.com/forums/topic/152785-logic-pro-x-importing-omf-aaf-files/
**Ton :** Communauté Logic pure, très technique. Parler leur langue.

> Logic's AAF support hasn't improved much since it was introduced — it works on clean, simple AAFs but falls apart with anything from a real NLE session.
>
> OMF with embedded audio is still the most reliable option for Logic, but not all NLEs export it properly. The middle ground I've been using is converting the AAF before it hits Logic — there's a free tool in beta called **AAF Cleaner** (aafcleaner.com) that takes the NLE export, re-links media, and outputs a Logic-friendly file. Works well on Premiere exports, still testing Avid and FCP.
>
> Worth a try before going the Pro Tools route.

---

## 5. Airwiggles — "AAF import in Reaper" (Game Audio)
🔗 https://www.airwiggles.com/c/gameaudio/aaf-import-in-reaper
**Ton :** Game audio community, Reaper-centric. Ils sont très pragmatiques.

> Reaper's native AAF support has gotten better but still hits edge cases depending on which NLE exported it.
>
> For game audio workflows where you're getting AAFs from video editors (Premiere, DaVinci, sometimes FCP), I've been testing a small tool called **AAF Cleaner** — aafcleaner.com — that normalizes the AAF before Reaper sees it, and can also output a .RPP directly with the clips placed and handles added.
>
> Free beta, Premiere exports are solid. Would love game audio people to stress-test it — your sessions tend to be more complex than straight film/TV deliveries.

---

## 6. Blackmagic Forum — "DaVinci Audio AAF Workflow (ProTools, Logic, Reaper)"
🔗 https://forum.blackmagicdesign.com/viewtopic.php?f=21&t=166006
**Ton :** DaVinci users, mixte éditeurs et sound people.

> DaVinci's AAF export is actually one of the better ones from an NLE — Fairlight's involvement helps — but it still has quirks when the receiving DAW isn't Pro Tools.
>
> Logic in particular struggles with the media references. I've been building a tool to fix this: **AAF Cleaner** (aafcleaner.com) takes DaVinci AAF exports and re-outputs them in a format Logic and Reaper handle cleanly. Still in beta on DaVinci files specifically — Premiere exports are solid — so if anyone has real DaVinci sessions to test, I'd love the files.

---

## 7. Gearspace — "AAF Import for REAPER – finally something that works"
🔗 https://gearspace.com/board/cockos-reaper/1462779-aaf-import-reaper-finally-something-works.html
**Ton :** Positionner AAF Cleaner comme complément, pas concurrent. Ne pas attaquer l'outil mentionné dans le thread.

> Good to see Reaper's AAF support improving. The import side is one piece — the other is what comes out of the NLE in the first place.
>
> I've been working on a tool that sits upstream: it normalizes the AAF before Reaper (or Logic) ever sees it. Cleans media references, adds handles, strips NLE-specific metadata that causes import failures. It's called **AAF Cleaner** — aafcleaner.com — free beta, Premiere exports well covered. Might be useful for edge cases where the AAF itself is malformed before it even hits the importer.

---

## 8. Cockos/Reaper Forum — "AAF import script"
🔗 https://forums.cockos.com/showthread.php?p=2525041
**Ton :** Très technique, communauté dev/power users Reaper. Parler script, pas marketing.

> Interesting thread — been following Reaper's AAF progress closely.
>
> I took a different approach: instead of handling the import on the Reaper side, I built a pre-processor that normalizes the AAF before it hits any DAW. Python-based, uses pyaaf2 under the hood, re-links media paths and strips problematic metadata. Outputs either a clean AAF or a .RPP directly.
>
> Still in beta — **aafcleaner.com** — Premiere exports are the most tested. Would be curious if anyone here wants to throw edge-case files at it, especially sessions where the NLE AAF itself is malformed.

---

## 📌 ORDRE DE PRIORITÉ

1. **Airwiggles** — communauté petite mais ultra-ciblée, réponse visible
2. **TalkBass** — thread émotionnel, ta réponse sera appréciée
3. **Blackmagic Forum** — DaVinci users, tes futurs testeurs
4. **Cockos Forum** — power users, peuvent devenir ambassadeurs
5. **Creative COW** — grande audience pro
6. **LogicProHelp** — Logic pure, très pertinent
7. **Gearspace x2** — après avoir construit un peu de karma sur le forum
