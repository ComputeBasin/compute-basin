module serverfarmchain::pool_escrow {
    use iota::balance::{Self, Balance};
    use iota::clock::{Self, Clock};
    use iota::coin::{Self, Coin};
    use iota::event;
    use iota::iota::IOTA;

    const E_NOT_ADMIN: u64 = 1;
    const E_INVALID_AMOUNT: u64 = 2;
    const E_POOL_CLOSED: u64 = 3;
    const E_DEADLINE_EXPIRED: u64 = 4;
    const E_POOL_ALREADY_FUNDED: u64 = 5;
    const E_POOL_NOT_FUNDED: u64 = 6;
    const E_DEADLINE_NOT_REACHED: u64 = 7;
    const E_RECEIPT_POOL_MISMATCH: u64 = 8;
    const E_RECEIPT_OWNER_MISMATCH: u64 = 9;
    const E_RECEIPT_ALREADY_REFUNDED: u64 = 10;
    const E_REFUND_NOT_ALLOWED_FOR_FUNDED_POOL: u64 = 11;
    const E_INSUFFICIENT_VAULT_BALANCE: u64 = 12;
    const E_INVALID_DEADLINE: u64 = 13;

    /// Shared escrow object representing one fundraising pool on-chain.
    public struct PoolEscrow has key, store {
        id: UID,
        admin: address,
        treasury: address,
        hard_cap_nanos: u64,
        raised_nanos: u64,
        deadline_ms: u64,
        funded: bool,
        closed: bool,
        total_withdrawn_nanos: u64,
        vault: Balance<IOTA>,
    }

    /// Receipt owned by contributor. Used as proof for refund claim after failure/deadline.
    public struct ContributionReceipt has key, store {
        id: UID,
        pool_id: object::ID,
        contributor: address,
        amount_nanos: u64,
        created_at_ms: u64,
        refunded: bool,
        refunded_at_ms: option::Option<u64>,
    }

    public struct PoolCreated has copy, drop {
        pool_id: object::ID,
        admin: address,
        treasury: address,
        hard_cap_nanos: u64,
        deadline_ms: u64,
        timestamp_ms: u64,
    }

    public struct ContributionAccepted has copy, drop {
        pool_id: object::ID,
        receipt_id: object::ID,
        contributor: address,
        amount_nanos: u64,
        raised_nanos: u64,
        hard_cap_nanos: u64,
        funded: bool,
        timestamp_ms: u64,
    }

    public struct PoolFunded has copy, drop {
        pool_id: object::ID,
        raised_nanos: u64,
        hard_cap_nanos: u64,
        timestamp_ms: u64,
    }

    public struct PoolWithdrawn has copy, drop {
        pool_id: object::ID,
        admin: address,
        treasury: address,
        amount_nanos: u64,
        total_withdrawn_nanos: u64,
        remaining_nanos: u64,
        timestamp_ms: u64,
    }

    public struct RefundClaimed has copy, drop {
        pool_id: object::ID,
        receipt_id: object::ID,
        contributor: address,
        amount_nanos: u64,
        timestamp_ms: u64,
    }

    /// Creates a shared on-chain escrow pool.
    /// The caller becomes admin; `treasury` receives withdrawals only when funding succeeds.
    public entry fun create_pool(
        hard_cap_nanos: u64,
        deadline_ms: u64,
        treasury: address,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(hard_cap_nanos > 0, E_INVALID_AMOUNT);
        let now_ms = clock::timestamp_ms(clock);
        assert!(deadline_ms > now_ms, E_INVALID_DEADLINE);

        let admin = tx_context::sender(ctx);
        let pool = PoolEscrow {
            id: object::new(ctx),
            admin,
            treasury,
            hard_cap_nanos,
            raised_nanos: 0,
            deadline_ms,
            funded: false,
            closed: false,
            total_withdrawn_nanos: 0,
            vault: balance::zero(),
        };
        let pool_id = object::id(&pool);

        event::emit(PoolCreated {
            pool_id,
            admin,
            treasury,
            hard_cap_nanos,
            deadline_ms,
            timestamp_ms: now_ms,
        });

        transfer::share_object(pool);
    }

    /// Deposits IOTA into pool escrow and mints a receipt to contributor.
    /// Automatically marks pool funded once hard-cap is reached.
    public entry fun contribute(
        pool: &mut PoolEscrow,
        payment: Coin<IOTA>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(!pool.closed, E_POOL_CLOSED);
        assert!(!pool.funded, E_POOL_ALREADY_FUNDED);

        let now_ms = clock::timestamp_ms(clock);
        assert!(now_ms <= pool.deadline_ms, E_DEADLINE_EXPIRED);

        let amount_nanos = coin::value(&payment);
        assert!(amount_nanos > 0, E_INVALID_AMOUNT);

        coin::put(&mut pool.vault, payment);
        pool.raised_nanos = pool.raised_nanos + amount_nanos;

        if (!pool.funded && pool.raised_nanos >= pool.hard_cap_nanos) {
            pool.funded = true;
            event::emit(PoolFunded {
                pool_id: object::id(pool),
                raised_nanos: pool.raised_nanos,
                hard_cap_nanos: pool.hard_cap_nanos,
                timestamp_ms: now_ms,
            });
        };

        let contributor = tx_context::sender(ctx);
        let receipt = ContributionReceipt {
            id: object::new(ctx),
            pool_id: object::id(pool),
            contributor,
            amount_nanos,
            created_at_ms: now_ms,
            refunded: false,
            refunded_at_ms: option::none(),
        };
        let receipt_id = object::id(&receipt);

        event::emit(ContributionAccepted {
            pool_id: object::id(pool),
            receipt_id,
            contributor,
            amount_nanos,
            raised_nanos: pool.raised_nanos,
            hard_cap_nanos: pool.hard_cap_nanos,
            funded: pool.funded,
            timestamp_ms: now_ms,
        });

        transfer::public_transfer(receipt, contributor);
    }

    /// Admin-only withdraw to treasury. Allowed only for funded pools.
    public entry fun withdraw_to_treasury(
        pool: &mut PoolEscrow,
        amount_nanos: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(!pool.closed, E_POOL_CLOSED);
        assert!(tx_context::sender(ctx) == pool.admin, E_NOT_ADMIN);
        assert!(pool.funded, E_POOL_NOT_FUNDED);
        assert!(amount_nanos > 0, E_INVALID_AMOUNT);
        assert!(balance::value(&pool.vault) >= amount_nanos, E_INSUFFICIENT_VAULT_BALANCE);

        let payout = coin::take(&mut pool.vault, amount_nanos, ctx);
        transfer::public_transfer(payout, pool.treasury);

        pool.total_withdrawn_nanos = pool.total_withdrawn_nanos + amount_nanos;
        if (balance::value(&pool.vault) == 0) {
            pool.closed = true;
        };

        event::emit(PoolWithdrawn {
            pool_id: object::id(pool),
            admin: tx_context::sender(ctx),
            treasury: pool.treasury,
            amount_nanos,
            total_withdrawn_nanos: pool.total_withdrawn_nanos,
            remaining_nanos: balance::value(&pool.vault),
            timestamp_ms: clock::timestamp_ms(clock),
        });
    }

    /// Contributor claims refund after deadline iff pool not funded.
    /// Receipt can be used only once.
    public entry fun refund(
        pool: &mut PoolEscrow,
        receipt: &mut ContributionReceipt,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        assert!(receipt.pool_id == object::id(pool), E_RECEIPT_POOL_MISMATCH);
        assert!(receipt.contributor == sender, E_RECEIPT_OWNER_MISMATCH);
        assert!(!receipt.refunded, E_RECEIPT_ALREADY_REFUNDED);

        let now_ms = clock::timestamp_ms(clock);
        assert!(now_ms > pool.deadline_ms, E_DEADLINE_NOT_REACHED);
        assert!(!pool.funded, E_REFUND_NOT_ALLOWED_FOR_FUNDED_POOL);
        assert!(balance::value(&pool.vault) >= receipt.amount_nanos, E_INSUFFICIENT_VAULT_BALANCE);

        let refund_coin = coin::take(&mut pool.vault, receipt.amount_nanos, ctx);
        receipt.refunded = true;
        receipt.refunded_at_ms = option::some(now_ms);
        transfer::public_transfer(refund_coin, sender);

        event::emit(RefundClaimed {
            pool_id: object::id(pool),
            receipt_id: object::id(receipt),
            contributor: sender,
            amount_nanos: receipt.amount_nanos,
            timestamp_ms: now_ms,
        });
    }

    /// Read-only helpers.
    public fun pool_id(pool: &PoolEscrow): object::ID {
        object::id(pool)
    }

    public fun hard_cap_nanos(pool: &PoolEscrow): u64 {
        pool.hard_cap_nanos
    }

    public fun raised_nanos(pool: &PoolEscrow): u64 {
        pool.raised_nanos
    }

    public fun deadline_ms(pool: &PoolEscrow): u64 {
        pool.deadline_ms
    }

    public fun funded(pool: &PoolEscrow): bool {
        pool.funded
    }

    public fun vault_balance_nanos(pool: &PoolEscrow): u64 {
        balance::value(&pool.vault)
    }

    public fun receipt_pool_id(receipt: &ContributionReceipt): object::ID {
        receipt.pool_id
    }

    public fun receipt_amount_nanos(receipt: &ContributionReceipt): u64 {
        receipt.amount_nanos
    }

    public fun receipt_contributor(receipt: &ContributionReceipt): address {
        receipt.contributor
    }

    public fun receipt_refunded(receipt: &ContributionReceipt): bool {
        receipt.refunded
    }
}
