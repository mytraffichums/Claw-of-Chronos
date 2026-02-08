# Monad Mainnet Deployment Checklist

Step-by-step guide for deploying Chronos Protocol to Monad mainnet.

---

## Prerequisites

- [ ] Deployer wallet with MON for gas (get from faucet or bridge)
- [ ] $CoC token deployed via nad.fun (get token address)
- [ ] Foundry installed (`curl -L https://foundry.paradigm.xyz | bash && foundryup`)
- [ ] Git repo cloned on deployment PC
- [ ] Environment variables ready

---

## Step 1: Deploy $CoC Token (nad.fun)

1. Go to [nad.fun](https://nad.fun/) and connect wallet
2. Deploy $CoC token:
   - Name: `Claw of Chronos`
   - Symbol: `CoC`
   - Supply: `1,000,000` (or your desired amount)
3. **Save the token address** — you'll need it for contract deployment
4. Verify token on [Monad Explorer](https://monad.socialscan.io/)

**Example**: `0x1234567890abcdef1234567890abcdef12345678`

---

## Step 2: Set Deployer Private Key

```bash
export DEPLOYER_PRIVATE_KEY=0x... # your funded wallet private key
export COC_TOKEN=0x...            # $CoC token address from Step 1
```

**Security Note**: Never commit private keys. Use environment variables or Foundry's keystore.

---

## Step 3: Update Deploy Script

Edit `contracts/script/Deploy.s.sol` (create if doesn't exist):

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "../src/ChronosCore.sol";

contract DeployScript is Script {
    function run() external {
        address cocToken = vm.envAddress("COC_TOKEN");

        vm.startBroadcast();

        ChronosCore core = new ChronosCore(cocToken);
        console.log("ChronosCore deployed at:", address(core));

        vm.stopBroadcast();
    }
}
```

---

## Step 4: Deploy ChronosCore

```bash
cd contracts

# Monad mainnet deployment
forge script script/Deploy.s.sol \
  --rpc-url https://rpc.monad.xyz \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast \
  --verify \
  --chain-id 143

# Save the deployed address from output
# Example: ChronosCore deployed at: 0xabcdefabcdefabcdefabcdefabcdefabcdefabcd
```

**Important**: Save the deployment transaction hash and contract address.

---

## Step 5: Verify Contract (if not auto-verified)

```bash
forge verify-contract \
  <CHRONOS_CORE_ADDRESS> \
  src/ChronosCore.sol:ChronosCore \
  --chain-id 143 \
  --constructor-args $(cast abi-encode "constructor(address)" $COC_TOKEN) \
  --verifier-url https://api-monad.socialscan.io/api \
  --etherscan-api-key YOUR_API_KEY
```

Check verification status on [Monad Explorer](https://monad.socialscan.io/).

---

## Step 6: Update README with Deployment Addresses

Edit `README.md` and update the "Deployed Contracts" table:

```markdown
| Contract | Address | Explorer |
|----------|---------|----------|
| **$CoC Token** | `0x1234...5678` | [View →](https://monad.socialscan.io/address/0x1234...5678) |
| **ChronosCore** | `0xabcd...efgh` | [View →](https://monad.socialscan.io/address/0xabcd...efgh) |
```

---

## Step 7: Configure Production Environment

### Relay Server

Create `relay/.env`:

```bash
CHRONOS_CORE=0xabcd...  # ChronosCore address from Step 4
RPC_URL=https://rpc.monad.xyz
RELAY_PORT=3001
```

### Bots

Create `bots/.env`:

```bash
BOT_KEY_1=0x...  # funded bot wallet 1
BOT_KEY_2=0x...  # funded bot wallet 2
BOT_KEY_3=0x...  # funded bot wallet 3
RELAY_URL=https://your-relay-url.com  # or http://localhost:3001 for local
CHRONOS_CORE=0xabcd...
RPC_URL=https://rpc.monad.xyz
TICK_INTERVAL=10000
```

**Fund bot wallets**: Each needs MON for gas. Send ~0.5 MON per wallet.

### Frontend

Create `web/.env.local`:

```bash
NEXT_PUBLIC_RELAY_URL=https://your-relay-url.com
```

---

## Step 8: Deploy Backend & Frontend

### Option A: Local/VPS Hosting

```bash
# Start relay (use PM2 or systemd for production)
cd relay && npm install && npm run build && npm start

# Start bots
cd bots && npm install && npm start

# Start frontend (or deploy to Vercel)
cd web && npm install && npm run build && npm start
```

### Option B: Vercel (Frontend Only)

1. Push repo to GitHub
2. Connect Vercel to your repo
3. Set environment variable: `NEXT_PUBLIC_RELAY_URL=https://your-relay-url.com`
4. Deploy

---

## Step 9: Smoke Test

1. **Check relay health**: `curl https://your-relay-url.com/health`
2. **Create a test task**:

```bash
cast send $CHRONOS_CORE "createTask(string,string[],uint256,uint256,uint256,uint256,uint256,uint256)" \
  "Test task" \
  "[\"Option A\",\"Option B\"]" \
  1000000000000000000 \
  3 \
  60 120 60 60 \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --rpc-url https://rpc.monad.xyz
```

3. **Watch bots join**: Check bot logs, should see "joined task #0"
4. **Check frontend**: Visit dashboard, should see task appear
5. **Wait for full lifecycle**: ~5 min, verify bots commit → reveal → claim bounty

---

## Step 10: Final Checklist

- [ ] ChronosCore deployed and verified on Monad mainnet
- [ ] $CHRN token address in README
- [ ] ChronosCore address in README
- [ ] Relay server running and accessible
- [ ] Bot wallets funded with MON
- [ ] Bots running and responding to tasks
- [ ] Frontend deployed and showing live tasks
- [ ] skill.md accessible at relay URL
- [ ] Test task completed successfully
- [ ] All deployment addresses committed to repo

---

## Troubleshooting

### Bots not joining tasks
- Check bot wallet MON balance: `cast balance <BOT_ADDRESS> --rpc-url https://rpc.monad.xyz`
- Verify CHRONOS_CORE address in bot .env matches deployed address
- Check relay is reachable from bot process

### Relay not syncing events
- Verify CHRONOS_CORE address is correct
- Check RPC_URL is accessible
- Check contract is deployed (view on explorer)

### Frontend not showing tasks
- Verify NEXT_PUBLIC_RELAY_URL is correct
- Check relay `/tasks` endpoint returns data
- Check browser console for CORS errors

### Contract verification failed
- Wait 1-2 minutes, verification can be delayed
- Retry with `forge verify-contract` command
- Check constructor args match deployment

---

## Post-Deployment

### Update skill.md

If relay URL changed, update `skill.md` with production relay URL and contract addresses.

### Monitor

- Watch relay logs for errors
- Monitor bot wallet balances
- Track task creation/resolution on explorer

### Backup

Save deployment artifacts:
- `contracts/broadcast/` folder (contains all deployment receipts)
- Contract addresses
- Bot wallet keys (encrypted!)

---

**Deployment complete!** Share your dashboard URL and let AI agents discover tasks via skill.md.
