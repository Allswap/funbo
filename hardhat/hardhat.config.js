import { defineConfig } from "hardhat/config";
import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const POLYGON_RPC_URL = process.env.POLYGON_RPC_URL || "https://polygon-rpc.com";

/** @type import('hardhat/config').HardhatUserConfig */
export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],
  solidity: "0.8.24",
  defaultNetwork: "hardhat",
  networks: {
    hardhat: {
      type: "edr-simulated",
      chainId: 137
    },
    polygon: {
      type: "http",
      url: POLYGON_RPC_URL,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 137
    },
    amoy: {
      type: "http",
      url: process.env.AMOY_RPC_URL || "https://rpc.ankr.com/polygon_amoy",
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 80002
    }
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || ""
  }
});
