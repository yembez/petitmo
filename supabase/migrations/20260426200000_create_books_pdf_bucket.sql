-- Bucket privé pour PDFs livre (URL signée courte côté client ; persistance premium).

insert into storage.buckets (id, name, public)
values ('books-pdf', 'books-pdf', false)
on conflict (id) do update set public = excluded.public;
