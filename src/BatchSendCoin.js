//@flow
const { Client } = require('pg')
var Web3 = require('web3');
var web3 = new Web3(new Web3.providers.WebsocketProvider("ws://127.0.0.1:9647"));
// const tokenABI = require('../config/tokenABI');
const airdropABI = require('../config/airdropABI');
const logger = require('./BatchSendCoinlogger');
const airdropAddress='0x92f3beed6bd6f4875468b20ef2578bc07f5e1d70' //空投合约地址
const controllerAddress='0x87dc0f8e8aa63e5c27d851e8e1a6e734150bcf81' //通过合约创建者调用空投的setController， 最好另外生成一个新的地址
const tokenAddress='0xfddb863dbff0632d57571a5af38482966e722ab4' //BO代币地址
const conString = "tcp://postgres:etz.123456@localhost/blockoptions"
const privateKey = '' //controller的私钥
const table_name = 'air_drop_20180621';
var airdropContract = new web3.eth.Contract(airdropABI, airdropAddress);
const batchSize = 30 //一次合约调用发送的数量, 例如现在是一次给一百个人发
const sendValue = 1000000000 //发送的金额
const maxPendingTx=1
const interval = 2000
var valuesArr = new Array(batchSize)
valuesArr.fill(sendValue)

// 合约地址里面要有bo，调用的时候实际是花的合约里面的代币， controller里面要有足够的以太零，用作维持交易频率

class BatchSendCoin {


  constructor (){
    this.maxSendAmount = maxPendingTx //合约调用的队列大小， 最多存在5笔处于pendding的调用
    this.currentPendingAmount = 0
    this.intervalId = 0
    this.arr = []
    this.total = 0
    this.finished = 0
    this.sended = 0
    this.finishState = false
    this.onError = (sendingAddrArrayStr) => {
      var doerror = (error) => {
        logger.error('transactionError: '+error, 'transaction state');
        var updateRevertSql="UPDATE "+table_name+" set state='3', updateAt='now()' where address IN ("+sendingAddrArrayStr+ ")";
        this.client.query(updateRevertSql).catch(e => {
          // console.log(e);
          logger.error(e.toString());
          logger.error('txHash store error: '+ receipt.transactionHash, 'datebaseUpdate');
        })
        if (this.currentPendingAmount>0) {
          this.currentPendingAmount--
        }
        this.finished++
      }
      return doerror
    }

    this.onSended = (sendingAddrArrayStr) => {
      var doSended = (txhash) => {
           var updateSendedSql="UPDATE "+table_name+" SET updateAt='now()' ,txHash='" + txhash + "' WHERE address IN ("+sendingAddrArrayStr+ ") AND state = 1";
           this.client.query(updateSendedSql).catch(e => {
             // console.log(e);
             logger.error(e.toString());
             logger.error('txHash update pending error: '+ txhash, 'datebaseUpdate');
           })
         }
      return doSended
    }


    this.onSuccess = (sendingAddrArrayStr) => {
      var dosucess = (confNumber, receipt) => {
        logger.info('transaction comfirm: '+ JSON.stringify(receipt.transactionHash), 'transaction state')
        var updateSuccessSql="update "+table_name+" set state='2', updateAt='now()' ,txHash='" + receipt.transactionHash + "' where state IN (0,1) AND address IN ("+sendingAddrArrayStr + ")";
        this.client.query(updateSuccessSql).catch(e => {
          logger.error('txHash store error: '+ receipt.transactionHash, 'datebaseUpdate');
        })
        if (this.currentPendingAmount>0) {
          this.currentPendingAmount--
        }
        this.finished++
        // console.log('confirmed: ',this.finished);
        logger.info('finished: '+this.finished);
      }
      return dosucess
    }
  }

  async sendcoin() {
    if (this.currentPendingAmount < this.maxSendAmount) {
      var power = await web3.eth.getPower(controllerAddress)
      power = web3.utils.fromWei(power,'gwei')
      if (this.sended < this.total && power >  50000000) {
        try {
          // console.log(11111);
          var willFinishIndex = ((this.sended + batchSize) >this.total)? this.total: this.sended+batchSize
          var sendingAddrArray = this.arr.slice(this.sended, willFinishIndex).map(function(row){ return row.address})
          var sendingAddrArrayStr = sendingAddrArray.map(function(address){ return '\'' + address + '\'' })
          let valueArray = valuesArr.slice(0, willFinishIndex-this.sended)
          this.sended=willFinishIndex
          // var address = row.address
          // var address="0xC9E976193E35B03712ce7E647F73CB2628b6aFe3";
          // var id = row.id
          // console.log(updatePendingSql);

          var data =airdropContract.methods['multiSend(address,address[],uint256[])'](tokenAddress, sendingAddrArray, valueArray).encodeABI();
          var txObject = await web3.eth.accounts.signTransaction({
            to: airdropAddress,
            data: data,
            gas: 2000000, //100个地址的话差不多时两百万左右，具体可以测试的时候看下交易的gas used做调整
            nonce: this.nonce++,
          },privateKey)
          // logger.info("txOBject: "+JSON.stringify(txObject))
          this.currentPendingAmount++
          web3.eth.sendSignedTransaction(txObject.rawTransaction)
          .once('transactionHash', this.onSended(sendingAddrArrayStr))
          .once('confirmation', this.onSuccess(sendingAddrArrayStr))
          .once('error', this.onError(sendingAddrArrayStr))
          var updatePendingSql="update "+table_name+" set state='1', updateAt='now()'  where state = 0 AND address IN ("+sendingAddrArrayStr+ ')';
          await this.client.query(updatePendingSql)
          logger.info('sended coin: '+ this.sended)
        } catch (e) {
          logger.error('unhandle eception: ' +e.toString());
        }
      } else {
        if (!this.finishState) {
          this.finishState = true
          logger.info('send coin finish at '+ new Date());
        }
        if (this.finished == Math.ceil(this.total/batchSize)) {
          logger.info('send coin task end at '+ new Date());
          clearInterval(this.intervalId)
          process.exit(1)
        }
      }
    }
  }

  async start() {
    this.client = new Client(conString)
    await this.client.connect()
    var res = await  this.client.query("SELECT * FROM " +table_name+" WHERE state=0")
    this.arr = res.rows
    this.total = this.arr.length
    logger.info('total address to send: ' + this.total);
    this.nonce = await web3.eth.getTransactionCount(controllerAddress)
    var startBlock = await web3.eth.getBlockNumber()
    var startBalance = await web3.eth.getBalance(controllerAddress)
    logger.info('start at balance: '+ startBalance);
    // this.sendcoin.bind(this)
    this.intervalId = setInterval(this.sendcoin.bind(this), interval)
  }
}

var o = new BatchSendCoin()
o.start()
