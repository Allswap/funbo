// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address owner) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IV3Router {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams memory params) external payable returns (uint256 amountOut);
}

interface IV2Router {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

contract ArbExecutor {
    enum SwapVersion { V2, V3 }
    
    address public owner;
    mapping(address => bool) public authorizedTokens;
    
    event ArbExecuted(
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 profit,
        address indexed router,
        SwapVersion version
    );
    event TokenApproved(address indexed token);
    event TokenRevoked(address indexed token);
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Unauthorized");
        _;
    }
    
    constructor() {
        owner = msg.sender;
    }
    
    function approveToken(address token) external onlyOwner {
        authorizedTokens[token] = true;
        emit TokenApproved(token);
    }
    
    function revokeToken(address token) external onlyOwner {
        authorizedTokens[token] = false;
        emit TokenRevoked(token);
    }
    
    function executeArb(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minOut,
        bytes calldata dexData
    ) external returns (uint256 amountOut) {
        require(authorizedTokens[tokenIn] || authorizedTokens[tokenOut], "Token not approved");
        
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        
        (uint8 version, address router) = abi.decode(dexData, (uint8, address));
        
        if (version == uint8(SwapVersion.V3)) {
            IV3Router.ExactInputSingleParams memory params = IV3Router.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: 3000,
                recipient: msg.sender,
                deadline: block.timestamp + 300,
                amountIn: amountIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            });
            
            amountOut = IV3Router(router).exactInputSingle(params);
        } else {
            address[] memory path = new address[](2);
            path[0] = tokenIn;
            path[1] = tokenOut;
            
            uint256[] memory amounts = IV2Router(router).swapExactTokensForTokens(
                amountIn,
                minOut,
                path,
                msg.sender,
                block.timestamp + 300
            );
            amountOut = amounts[amounts.length - 1];
        }
        
        IERC20(tokenOut).transfer(msg.sender, amountOut);
        
        emit ArbExecuted(tokenIn, tokenOut, amountIn, amountOut, amountOut - amountIn, router, SwapVersion(version));
    }
    
    function withdraw(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(msg.sender, amount);
    }
    
    function withdrawETH(uint256 amount) external onlyOwner {
        payable(msg.sender).transfer(amount);
    }
    
    receive() external payable {}
}