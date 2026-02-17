# serverfarmchain/contracts

Modulo Move IOTA per MVP:
- `SiteNFT`
- `DocProof`
- `ReservationToken`

## Entry functions

- `mint_site_nft(...)` -> crea e condivide (`shared`) il SiteNFT
- `notarize_document(...)`
- `reserve_capacity(...)` -> wallet caller
- `reserve_capacity_for(...)` -> backend service verso wallet target

## Build

```bash
iota move build --force
```
