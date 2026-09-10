# TOP — šah sa privremenim tajnim četom

TOP je Coolify-ready Node.js aplikacija na srpskom jeziku. Koristi `chess.js`, Express, Socket.IO i PostgreSQL.

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
