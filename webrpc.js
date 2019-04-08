var Web3 = require('web3');

if (typeof Web3 !== 'undefined')
{
    web3 = new Web3(Web3.currentProvider);
}
else {
    web3 = new Web3(new Web3.providers.HttpProvider("ws://0.0.0.0:8545"));
}
module.exports = web3;
