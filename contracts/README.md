# serverfarmchain/contracts

Modulo Move IOTA per MVP:
- `SiteNFT`
- `DocProof`
- `ReservationToken`
- `PoolEscrow`
- `ContributionReceipt`

## Entry functions

- `mint_site_nft(...)` -> crea e condivide (`shared`) il SiteNFT
- `notarize_document(...)`
- `reserve_capacity(...)` -> wallet caller
- `reserve_capacity_for(...)` -> backend service verso wallet target
- `create_pool(...)` -> crea escrow pool shared con cap e deadline
- `contribute(...)` -> deposita IOTA nel pool escrow e emette receipt
- `withdraw_to_treasury(...)` -> admin withdraw solo se funded
- `refund(...)` -> contributor refund trustless dopo deadline se non funded

## Build

```bash
iota move build --force
```
