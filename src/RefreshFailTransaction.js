//@flow
const { Client } = require('pg')
var Web3 = require('web3');
var web3 = new Web3("ws://etzrpc.org:2052");
// const tokenABI = require('../config/tokenABI');
// const airdropABI = require('../config/airdropABI');
const logger = require('./logger')
const conString = "tcp://postgres:etz.123456@localhost/blockoptions"
const table_name = 'air_drop_etz001';

// 合约地址里面要有bo，调用的时候实际是花的合约里面的代币， controller里面要有足够的以太零，用作维持交易频率

class RefreshFailTransaction {

  async start() {
    this.client = new Client(conString)
    await this.client.connect()
    var res = await this.client.query('SELECT distinct(txhash) FROM '+table_name+' WHERE state <> 2 and txhash is not null')
    var refreshNum = 0
    for (var i = 0; i < res.rows.length; i++) {
      try{
        var result = await web3.eth.getTransactionReceipt(res.rows[i].txhash)
        if (result.status) {
          console.log(res.rows[i].txhash + 'update success')
          await this.client.query('update ' + table_name + ' set state = 2 where txhash = \'' + res.rows[i].txhash + '\'')
          refreshNum ++ 
        }
      }catch(e) {
        // console.log(e)
        // return
      }
    }
    console.log('refresh success tx: ' + refreshNum)
  }
}

var task = new RefreshFailTransaction()
task.start()
