# ServerFarmChain

Implementazione completa del nuovo flusso:

- Admin wallet crea pool terreni con documentazione notarizzata (Google Drive + hash)
- Participant wallet compra token nelle pool e monitora avanzamento
- Gli stessi token vengono spesi per noleggio potenza compute su pool operative
- Atto di acquisto notarizzato quando la pool raggiunge il funding target

## Moduli

- `backend/`: API admin/pool/compute/rental
- `landing-page/`: UI React + Tailwind + wallet IOTA
- `contracts/`: Move package `passport`

## Run rapido

```bash
cd backend && npm run dev
cd landing-page && npm run dev
```
