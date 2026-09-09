# TOP — šah sa privremenim tajnim četom

TOP je Coolify-ready Node.js aplikacija na srpskom jeziku. Koristi `chess.js`, Express, Socket.IO i PostgreSQL.

## Pokretanje

```bash
docker compose up --build
```

Otvori `http://localhost:8080`.

## Coolify

Poveži ovaj GitHub repository kao Docker Compose projekat. Aplikacija koristi port `8080`. PostgreSQL servis i inicijalna šema nalaze se u `docker-compose.yml` i `schema.sql`.

Pre produkcije promeni `JWT_SECRET`, `MNEMONIC_PEPPER` i `ANONYMOUS_SECRET_MOVES` u environment podešavanjima.

Za GitHub/Coolify koristi privatni repository i nikada ne postavljaj `.env` fajl u Git. `.env.example` je samo šablon.

## Privatnost tajnog četa

Poruke tajnog četa postoje samo u RAM-u aktivne partije. Ne upisuju se u PostgreSQL, fajlove ili logove i brišu se kada se partija završi ili server restartuje.
