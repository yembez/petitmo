-- Bucket privé pour les médias compressés « scan QR livre » (accès via signed URL côté service PDF).

insert into storage.buckets (id, name, public)
values ('qr-media', 'qr-media', false)
on conflict (id) do update set public = excluded.public;
