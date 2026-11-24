# Loyalty demo client accounts

The project seeds four development-only guest accounts so the loyalty tiers, reservation history, and visual treatments can be demonstrated.

| Loyalty tier | Email | Password | Completed stays | Booking discount | Example reservation history |
|---|---|---|---:|---:|---:|
| None | `demo.none@hotel.test` | `NoneTier#2026` | 0 | 0% | No completed stays yet |
| Silver | `demo.silver@hotel.test` | `SilverTier#2026` | 2 | 5% | 2 completed reservations |
| Gold | `demo.gold@hotel.test` | `GoldTier#2026` | 5 | 8% | 5 completed reservations |
| Platinum | `demo.platinum@hotel.test` | `PlatinumTier#2026` | 10 | 12% | 10 completed reservations |

The loyalty starting points are held in `demo_loyalty_profiles`. For the sample Silver, Gold and Platinum users, the database migration links existing completed demo reservations to the sample accounts so the **My reservations** page demonstrates a real saved history. It reassigns existing unclaimed demo rows instead of inserting reservations, so the total number of demo reservations and payments is unchanged. The None account starts with no completed stays. New completed stays can still move a demo account toward the next tier; the starting point does not freeze its progress.

After signing in, open **My reservations** to see all reservations for that account without typing a booking number or QR code. Click the loyalty badge in the header to see how many more completed stays are needed for the next level. When a guest books while signed in, the new reservation is attached to that guest account automatically.

These passwords are for local demonstration only. Change or remove the sample accounts before deploying the project publicly. Existing demo accounts keep their password on subsequent starts; new demo accounts are created with the passwords shown above.
