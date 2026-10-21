/**
 * Wipes every ride and transaction so the books start clean. Accounts stay.
 *   node scripts/reset-demo.mjs
 */
import { resetDemoData } from '../src/services/reset.js';

resetDemoData();
console.log('All rides, wallet transactions and the company ledger were cleared. Wallets are ₹0. Accounts, vehicles, prices and promo codes were kept.');
