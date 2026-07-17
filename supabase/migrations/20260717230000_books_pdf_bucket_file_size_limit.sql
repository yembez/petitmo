-- PDFs livre impression (Gelato) : un livre ~50–60 pages print peut dépasser 50 Mo.
-- Sans limite explicite, le plafond global Storage (souvent 50 Mo) rejette l’upload :
-- « The object exceeded the maximum allowed size ».
--
-- 200 Mo = marge pour livres longs ; ne peut pas dépasser le Global file size limit
-- du projet (Dashboard → Storage → Settings). Sur Free max 50 Mo : il faut Pro +
-- relever le global, puis cette migration s’applique.

update storage.buckets
set file_size_limit = 209715200 -- 200 MiB
where id = 'books-pdf';
