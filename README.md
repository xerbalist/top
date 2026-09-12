# TOP — šah sa privremenim tajnim četom

TOP je Coolify-ready Node.js aplikacija na srpskom jeziku. Koristi `chess.js`, Express, Socket.IO i PostgreSQL.

Interfejs koristi moderan tamni stil šahovskih platformi, prilagodljiv je telefonu
i računaru, prikazuje legalna odredišta i označava poslednji potez. Sa početne
strane se partija protiv ugrađenog TOP Bota igra direktno na velikoj tabli, dok
su ostale akcije dostupne iz stalnog bočnog menija. Bot ne koristi
spoljni servis: radi kroz laganu alpha-beta pretragu i evaluaciju pozicije nad
`chess.js` pravilima.

Korisnički profil podržava profilnu sliku, kratku biografiju i državu. Slika se
u browseru smanjuje na 256×256 i zajedno sa ostalim podacima čuva u PostgreSQL
bazi, tako da ne nestaje pri ponovnom pokretanju Coolify kontejnera.

Početna strana uvek prikazuje šahovsku tablu. Registrovani korisnik u profilu
unosi dve nezavisne sekvence od po pet poteza: jednu za bele i jednu za crne
figure. Kada prijatelj prihvati izazov, oba trenutno povezana igrača automatski
se prebacuju u novu partiju.

Mnemonic fraza se pravi isključivo od srpskih reči koje se izvorno pišu bez
dijakritika. Prikazuje se samo jednom, neposredno posle registracije, kada može
da se kopira ili preuzme kao tekstualni fajl.

## Pokretanje

Za lokalni razvoj: `npm ci`, zatim `NODE_ENV=development PORT=8080 PUBLIC_URL=http://localhost:8080 npm start`.
PostgreSQL konekcija je potrebna za naloge; anonimne test-partije mogu raditi bez baze.
Produkcijski Docker Compose zahteva HTTPS proxy i popunjene environment promenljive.

## Coolify

Poveži ovaj GitHub repository kao Docker Compose projekat. Aplikacija koristi port `8080`. PostgreSQL servis i inicijalna šema nalaze se u `docker-compose.yml` i `schema.sql`.

Pre produkcije promeni `POSTGRES_PASSWORD`, `JWT_SECRET`,
`MNEMONIC_PEPPER` i `ANONYMOUS_SECRET_MOVES` u environment podešavanjima.
Obavezno postavi `PUBLIC_URL=https://top.xn--1ea.cc` (ili tačnu HTTPS adresu aplikacije).
`JWT_SECRET` i `MNEMONIC_PEPPER` moraju imati najmanje 32 bajta; koristi nezavisne nasumične vrednosti.
Ne menjaj postojeći `MNEMONIC_PEPPER`: stare fraze zavise od njega.
Sesije koriste `HttpOnly`, `SameSite=Strict` i obavezno `Secure` u produkciji.
`TRUST_PROXY_HOPS` mora odgovarati stvarnom proxy lancu; direktan pristup app portu blokiraj firewallom.

Coolify health-check koristi `GET /api/health` na portu `8080` i proverava dostupnost PostgreSQL baze.

Repozitorijum može biti javan; nikada ne postavljaj stvarne tajne ili `.env` u Git. `.env.example` je samo šablon.

## Bezbednosna nadogradnja

- Stare JWT prijave ne važe posle nadogradnje; korisnici se prijavljuju ponovo. Aktivne partije su u memoriji i gube se pri redeployu.
- Šema automatski dodaje `sessions` i verziju autentifikacije. Pre redeploya napravi backup PostgreSQL baze i proveri migraciju na staging instanci.
- Gosti imaju potpisane, opozive sesije u memoriji procesa. Javni ID igrača nije akreditiv.
- Promena i oporavak lozinke poništavaju sve prijave, a odjava poništava trenutnu. Profil nudi odjavu svih uređaja i zamenu mnemonic fraze.
- Nove fraze imaju 18 reči (~134,7 bita); ranije 12-rečne fraze ostaju važeće. Nova lozinka: najmanje 12 znakova, najviše 72 UTF-8 bajta zbog bcrypt ograničenja.
- HTTP i socket limiti su lokalni procesu. Aplikacija sa partijama u memoriji podržava jedan app proces; više replika zahteva zajedničko stanje i distribuirane limitere. Ne stavljati poruke u Redis niti trajne redove.
- Bot pretraga radi u ograničenim workerima, ne u glavnoj petlji servera.
- `npm test` obuhvata negativne HTTP testove, sesije, kriptografiju i integracioni tok preko PGlite (PostgreSQL WASM) i Socket.IO. Test baza je samo privremena memorija, bez produkcijskih podataka.
- `npm audit --omit=dev` proverava zavisnosti; `qs` override je bezbednosna zakrpa za GHSA-4mjr-xmp4-gh2g i GHSA-x5fp-wj9c-mxmx.

### Produkcijske provere izvan codebase-a

Kontejner radi kao `node`, bez dodatnih capabilities, sa read-only filesystemom u Compose konfiguraciji.
Postojeći PostgreSQL bootstrap korisnik iz Compose-a je administrativan. Za produkciju koristi odvojen migration nalog i ograničen runtime nalog (SELECT/INSERT/UPDATE/DELETE i sequence USAGE). `npm run migrate` izvršava migraciju preko zasebnog `MIGRATION_DATABASE_URL`; zatim runtime podesiti sa `RUN_MIGRATIONS=false` i ograničenim `DATABASE_URL`. Ne prosleđivati migration akreditiv trajnom app kontejneru. Podrazumevano migracije ostaju pri pokretanju zbog kompatibilnosti sa postojećim Coolify setupom. Konkretnu DB ulogu i grantove treba podesiti na tvojoj instanci.
Proveri firewall, Cloudflare/Coolify HTTPS i proxy hopove, isključi beleženje request body-ja i socket payload-a u infrastrukturi/APM-u, isključi core dumpove, i proveri šifrovane backup-e baze i restore proceduru.
Ove infrastrukturne postavke nisu automatski promenjene ovim commitom.

## Privatnost tajnog četa

Tek kada su ispunjeni uslovi za čet, browseri razmenjuju privremene P-256 ECDH javne ključeve.
HKDF-SHA256 izvodi zasebne AES-256-GCM ključeve za oba smera; sadržaj, identitet pošiljaoca, broj poruke i partija vezani su autentifikovanim kontekstom.
Oba igrača moraju uporediti sigurnosni kod nezavisnim pouzdanim kanalom (npr. telefonom) i potvrditi podudaranje pre slanja. Bez poređenja kodova javni ključ prosleđen preko servera nije dokaz identiteta.
Server prima samo šifrat i metapodatke, ne plaintext. Ne upisuje poruke u bazu, fajlove ili aplikacione logove i nema red istorije/replay poruka. Ipak, šifrat privremeno prolazi kroz RAM i mrežne bafere; apsolutna tvrdnja „nikakvi podaci nikad nisu na serveru” nije tačna.
Kraj partije, promena ključa, odjava ili prekid veze brišu prikazane poruke/ključne reference. Posle prekida potrebna je nova potvrda koda. Browser prikazuje najviše 100 poruka. Nema garancije fizičkog prepisivanja JavaScript memorije, niti zaštite od snimka ekrana ili kompromitovanog browsera.
Ovo je testirana implementacija standardnih Web Crypto primitiva, ne nezavisno revidiran protokol poput Signal-a. Aktivno kompromitovan server može isporučiti izmenjen JavaScript; za takav model pretnje potreban je nezavisno distribuiran/verifikovan klijent.
