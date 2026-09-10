# TOP — šah sa privremenim tajnim četom

TOP je Coolify-ready Node.js aplikacija na srpskom jeziku. Koristi `chess.js`, Express, Socket.IO i PostgreSQL.

Interfejs koristi moderan tamni stil šahovskih platformi, prilagodljiv je telefonu
i računaru, prikazuje legalna odredišta i označava poslednji potez. Sa početne
strane može odmah da se pokrene partija protiv ugrađenog TOP Bota. Bot ne koristi
spoljni servis: radi kroz laganu alpha-beta pretragu i evaluaciju pozicije nad
`chess.js` pravilima.

Početna strana uvek prikazuje šahovsku tablu. Registrovani korisnik u profilu
unosi dve nezavisne sekvence od po pet poteza: jednu za bele i jednu za crne
figure. Kada prijatelj prihvati izazov, oba trenutno povezana igrača automatski
se prebacuju u novu partiju.

Mnemonic fraza se pravi isključivo od srpskih reči koje se izvorno pišu bez
dijakritika. Prikazuje se samo jednom, neposredno posle registracije, kada može
da se kopira ili preuzme kao tekstualni fajl.

## Pokretanje

```bash
docker compose up --build
```

Otvori `http://localhost:8080`.

## Coolify

Poveži ovaj GitHub repository kao Docker Compose projekat. Aplikacija koristi port `8080`. PostgreSQL servis i inicijalna šema nalaze se u `docker-compose.yml` i `schema.sql`.

Pre produkcije promeni `POSTGRES_PASSWORD`, `JWT_SECRET`,
`MNEMONIC_PEPPER` i `ANONYMOUS_SECRET_MOVES` u environment podešavanjima.
Sesija koristi `HttpOnly` i `SameSite=Lax` cookie, a preko Coolify HTTPS
proxy-ja automatski dobija i `Secure` oznaku.

Coolify health-check koristi `GET /api/health` na portu `8080` i proverava dostupnost PostgreSQL baze.

Za GitHub/Coolify koristi privatni repository i nikada ne postavljaj `.env` fajl u Git. `.env.example` je samo šablon.

## Privatnost tajnog četa

Server poruke samo prosleđuje trenutno povezanim igračima. Ne zadržava ih ni u
RAM nizu, niti ih upisuje u PostgreSQL, fajlove, logove, analitiku ili backup.
Kada se partija završi, slanje poruka se odmah onemogućava.
