module serverfarmchain::passport {
    use std::string::String;
    use iota::event;

    const E_INVALID_RESERVATION_UNITS: u64 = 1;

    /// NFT che rappresenta un sito compute-ready.
    public struct SiteNFT has key, store {
        id: object::UID,
        site_code: String,
        site_type: String,
        area_m2: u64,
        target_kw: u64,
        approx_location: String,
        owner: address,
    }

    /// Notarizzazione di un documento: hash + timestamp + issuer.
    public struct DocProof has key, store {
        id: object::UID,
        site_id: object::ID,
        doc_type: String,
        doc_hash_sha256: vector<u8>,
        timestamp_ms: u64,
        issuer: address,
    }

    /// Token/oggetto di prenotazione capacità o slot temporaneo.
    public struct ReservationToken has key, store {
        id: object::UID,
        site_id: object::ID,
        reserved_kw_units: u64,
        expires_at_ms: u64,
        holder: address,
    }

    public struct SiteMinted has copy, drop {
        site_id: object::ID,
        owner: address,
        target_kw: u64,
    }

    public struct DocumentNotarized has copy, drop {
        proof_id: object::ID,
        site_id: object::ID,
        issuer: address,
        timestamp_ms: u64,
    }

    public struct CapacityReserved has copy, drop {
        reservation_id: object::ID,
        site_id: object::ID,
        holder: address,
        reserved_kw_units: u64,
        expires_at_ms: u64,
    }

    public entry fun mint_site_nft(
        site_code: String,
        site_type: String,
        area_m2: u64,
        target_kw: u64,
        approx_location: String,
        ctx: &mut tx_context::TxContext
    ) {
        let sender = tx_context::sender(ctx);

        let site = SiteNFT {
            id: object::new(ctx),
            site_code,
            site_type,
            area_m2,
            target_kw,
            approx_location,
            owner: sender,
        };

        let site_id = object::id(&site);
        event::emit(SiteMinted {
            site_id,
            owner: sender,
            target_kw,
        });

        // Shared object: permette a buyer diversi di fare reserve/notarize su questo site passport.
        transfer::public_share_object(site);
    }

    public entry fun notarize_document(
        site: &SiteNFT,
        doc_type: String,
        doc_hash_sha256: vector<u8>,
        timestamp_ms: u64,
        ctx: &mut tx_context::TxContext
    ) {
        let issuer = tx_context::sender(ctx);

        let proof = DocProof {
            id: object::new(ctx),
            site_id: object::id(site),
            doc_type,
            doc_hash_sha256,
            timestamp_ms,
            issuer,
        };

        let proof_id = object::id(&proof);
        event::emit(DocumentNotarized {
            proof_id,
            site_id: object::id(site),
            issuer,
            timestamp_ms,
        });

        transfer::public_transfer(proof, issuer);
    }

    public entry fun reserve_capacity(
        site: &SiteNFT,
        reserved_kw_units: u64,
        expires_at_ms: u64,
        ctx: &mut tx_context::TxContext
    ) {
        assert!(reserved_kw_units > 0, E_INVALID_RESERVATION_UNITS);

        let holder = tx_context::sender(ctx);
        let reservation = ReservationToken {
            id: object::new(ctx),
            site_id: object::id(site),
            reserved_kw_units,
            expires_at_ms,
            holder,
        };

        let reservation_id = object::id(&reservation);
        event::emit(CapacityReserved {
            reservation_id,
            site_id: object::id(site),
            holder,
            reserved_kw_units,
            expires_at_ms,
        });

        transfer::public_transfer(reservation, holder);
    }

    /// Variante per backend service: emette la reservation direttamente verso un wallet target.
    public entry fun reserve_capacity_for(
        site: &SiteNFT,
        reserved_kw_units: u64,
        expires_at_ms: u64,
        holder: address,
        ctx: &mut tx_context::TxContext
    ) {
        assert!(reserved_kw_units > 0, E_INVALID_RESERVATION_UNITS);

        let reservation = ReservationToken {
            id: object::new(ctx),
            site_id: object::id(site),
            reserved_kw_units,
            expires_at_ms,
            holder,
        };

        let reservation_id = object::id(&reservation);
        event::emit(CapacityReserved {
            reservation_id,
            site_id: object::id(site),
            holder,
            reserved_kw_units,
            expires_at_ms,
        });

        transfer::public_transfer(reservation, holder);
    }
}
