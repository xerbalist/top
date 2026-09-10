# TOP — objedinjeni prompt

Napravi full-stack šahovsku aplikaciju pod nazivom **TOP**, sa topom kao glavnim logotipom. Aplikacija mora biti na srpskom jeziku, u srpskoj latinici. Koristi `chess.js` za validaciju svih poteza na backendu, Node.js, Express, Socket.IO, PostgreSQL i Docker deployment pogodan za Coolify.

Podrži anonimne partije i registrovane korisnike. Registracija koristi korisničko ime i lozinku. Oporavak je moguć isključivo pomoću mnemonic fraze od 12 ili 15 srpskih reči bez dijakritike, samo `a-z`, na primer `sova golub motika`. Nikada ne koristi reči kao `šećer`, `kučka`, `mršav`, `žaba`, `đak`, `čamac` ili `ćebe`. Fraza se prikazuje samo jednom, a na serveru se čuva samo bezbedan hash.

Korisnik u profilu postavlja dve nezavisne sekvence od po tačno pet tajnih poteza tako što ih pravi na dve interaktivne table: jednu za bele i jednu za crne figure. Backend validira i čuva obe sekvence. Kod anonimnih igrača sekvenca od tačno pet poteza za svaku boju podešava se isključivo u backendu. Svaki anonimni igrač koji u istoj partiji odigra odgovarajuću backend sekvencu tačnim redom automatski otključava privremeni tajni čet. Kod registrovanih igrača oba igrača moraju odigrati svojih pet poteza tačno po redu. Čet se nikada ne čuva u bazi, fajlovima, logovima, analitici ili backup-u; postoji samo u memoriji dok partija traje i briše se po završetku, napuštanju ili restartu servera. Nema sata.

Podrži mat, pat, remi, predaju i normalan završetak partije. Početna strana uvek prikazuje šahovsku tablu. Dodaj prijatelje, zahteve za prijateljstvo, blokiranje, listu prijatelja i dugme „Izazovi prijatelja“. Izazov stvara privatnu pozivnicu sa prihvatanjem, odbijanjem i istekom; prihvatanje automatski otvara partiju kod oba povezana igrača. Dodaj status feed nalik Twitteru: objava do 280 karaktera, izmena, brisanje, lajkovi, odgovori i osnovno prijavljivanje. Statusi su persistentni, ali tajni čet nije.

UI treba da bude uglađen, moderan i vizuelno inspirisan vodećim šahovskim platformama: tamna pozadina, zelene akcije, bočna navigacija, velika tabla, jasan panel partije, oznaka poslednjeg poteza i prikaz legalnih odredišta. Ne kopiraj tuđe logotipe ili zaštićene elemente. Omogući igru protiv ugrađenog lightweight TOP Bota koji koristi `chess.js`, evaluaciju materijala i pozicije i alpha-beta pretragu, bez spoljnog AI servisa.

Mnemonic fraza mora da koristi samo srpske reči koje se prirodno pišu bez dijakritika, nikada ošišanu latinicu. Posle registracije omogući kopiranje i preuzimanje fraze kao `.txt` fajla.

Interfejs neka bude jednostavan, moderan i vizuelno inspirisan Lichess-om, bez napredne analize, rejtinga, turnira, Stockfish-a, javnih soba ili privatnih poruka. Svi važni podaci i potezi moraju se proveravati na serveru. Dodaj rate limiting, bezbedne hash funkcije za lozinke, sesije/JWT u sigurnim cookie-jima, validaciju unosa, cleanup memorijskih soba i Coolify/Docker dokumentaciju.
