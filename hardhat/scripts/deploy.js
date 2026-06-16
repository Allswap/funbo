async function main() {
  const [deployer] = await ethers.getSigners();
  
  console.log("Deploying ArbExecutor to Polygon...");
  console.log("Deployer address:", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", balance.toString());
  
  const ArbExecutor = await ethers.getContractFactory("ArbExecutor");
  const executor = await ArbExecutor.deploy();
  
  await executor.waitForDeployment();
  
  const address = await executor.getAddress();
  console.log("ArbExecutor deployed to:", address);
  
  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (apiKey) {
    console.log("Verifying contract on Polygonscan...");
    await hre.run("verify:verify", {
      address: address,
      constructorArguments: [],
    });
    console.log("Contract verified!");
  }
  
  console.log("\n--- Next Steps ---");
  console.log("1. Add to dashboard ConfigManager: executor_contract_address =", address);
  console.log("2. Set executor_mode to 'contract' in dashboard");
  console.log("3. Approve tokens via contract before trading");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });