# FlashLoanArb Deployment

## Contract Details
- **File**: `src/FlashLoanArb.sol` ✅ Compiles
- **Aave V3 Pool**: `0x794a61358D6845594F94dc1DB02A252b5b4814aD`
- **Flash Loan Fee**: 0.05% (Aave V3 default)
- **Router Addresses**:
  - SushiSwap V2: `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506`
  - QuickSwap V2: `0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff`

## Deploy to Polygon

### Step 1: Get bot wallet private key
```bash
npx wrangler secret get PRIVATE_KEY --scope worker funbo-execution
```
Copy the output value.

### Step 2: Deploy contract
```bash
PRIVATE_KEY=<bot-wallet-key> forge create \
  --rpc-url https://polygon-bor-rpc.publicnode.com \
  --private-key $PRIVATE_KEY \
  --broadcast \
  src/FlashLoanArb.sol:FlashLoanArb
```

### Step 3: Verify deployment
```bash
cast code <deployed-address> --rpc-url https://polygon-bor-rpc.publicnode.com
```

## Bot Integration

After deployment, add this to `worker/funbo-execution/src/index.ts`:

```js
const FLASH_LOAN_ARB = "0x<deployed-address>";

// In executeOpportunity or executeTriangularArb, add:
// If opportunity has enough spread (gas + 0.05% fee), call flash loan
async function tryFlashLoanArb(opportunity) {
  // Calculate required flash loan amount
  // Call FLASH_LOAN_ARB.executeFlashLoan(tokenBorrow, amount, tokenSwap, routerBuy, routerSell, minProfit)
}
```

## Contract ABI (for bot integration):
```json
[
  {
    "inputs": [
      {"internalType": "address", "name": "tokenBorrow", "type": "address"},
      {"internalType": "uint256", "name": "amount", "type": "uint256"},
      {"internalType": "address", "name": "tokenSwap", "type": "address"},
      {"internalType": "address", "name": "routerBuy", "type": "address"},
      {"internalType": "address", "name": "routerSell", "type": "address"},
      {"internalType": "uint256", "name": "minProfit", "type": "uint256"}
    ],
    "name": "executeFlashLoan",
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "inputs": [],
    "name": "owner",
    "outputs": [{"internalType": "address", "type": "address"}],
    "stateMutability": "view"
  }
]
```
