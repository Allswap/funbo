// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IPool {
    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

interface IFlashLoanSimpleReceiver {
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool);
}

interface IUniswapV2Router {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

contract FlashLoanArb is IFlashLoanSimpleReceiver {
    address public owner;
    address public constant POOL = 0x794a61358D6845594F94dc1DB02A252b5b4814aD;

    address public constant SUSHI_ROUTER = 0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506;
    address public constant QUICKSWAP_ROUTER = 0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff;

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function executeFlashLoan(
        address tokenBorrow,
        uint256 amount,
        address tokenSwap,
        address routerBuy,
        address routerSell,
        uint256 minProfit
    ) external onlyOwner {
        IERC20(tokenBorrow).approve(POOL, amount);
        bytes memory params = abi.encode(tokenSwap, routerBuy, routerSell, minProfit);
        IPool(POOL).flashLoanSimple(address(this), tokenBorrow, amount, params, 0);
    }

    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        require(msg.sender == POOL, "Caller must be Aave Pool");
        require(initiator == address(this), "Initiator must be this contract");

        (address tokenSwap, address routerBuy, address routerSell, uint256 minProfit) =
            abi.decode(params, (address, address, address, uint256));

        uint256 swapAmount = _swap(routerBuy, asset, tokenSwap, amount);
        uint256 backAmount = _swap(routerSell, tokenSwap, asset, swapAmount);

        uint256 totalOwed = amount + premium;
        require(backAmount >= totalOwed, "Not profitable");
        require(backAmount - totalOwed >= minProfit, "Profit below min");

        IERC20(asset).approve(POOL, totalOwed);
        uint256 profit = backAmount - totalOwed;
        if (profit > 0) {
            IERC20(asset).transfer(owner, profit);
        }
        return true;
    }

    function _swap(
        address router,
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) internal returns (uint256) {
        IERC20(tokenIn).approve(router, amountIn);
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;
        uint256[] memory amounts = IUniswapV2Router(router).swapExactTokensForTokens(
            amountIn, 0, path, address(this), block.timestamp + 300
        );
        return amounts[1];
    }

    function rescueToken(address token) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "No balance");
        IERC20(token).transfer(owner, balance);
    }

    function rescuePol() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No balance");
        payable(owner).transfer(balance);
    }

    receive() external payable {}
}
