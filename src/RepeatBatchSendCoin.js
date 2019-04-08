//@flow
const { Client } = require('pg')
var Web3 = require('web3');
var web3 = new Web3(new Web3.providers.WebsocketProvider("ws://127.0.0.1:8546"));
const tokenABI = require('../config/tokenABI');
const airdropABI = require('../config/airdropABI');
const logger = require('./logger')
const airdropAddress='0x0ac5b7554c81f4bbda1056fd6ee2614a64c0072c' //空投合约地址
const controllerAddress='0xB4abf73F01938688Cd9Ec7D285a37434d4Fb11Fd' //通过合约创建者调用空投的setController， 最好另外生成一个新的地址
const tokenAddress='0x86d105d5fa67f3eef986f75b7e63c6664f88319a'  //BO代币地址
const conString = "tcp://postgres:etz.123456@localhost/blockoptions"
const privateKey = '' //controller的私钥
const table_name = 'air_drop_20180626';
const controllSigTable = table_name+'_controll_sig'
var airdropContract = new web3.eth.Contract(airdropABI, airdropAddress);
const batchSize = 30 //一次合约调用发送的数量, 例如现在是一次给一百个人发
const maxPendingTx=3
const minSendTrigger = 0
const interval = 2000
// var valuesArr = new Array(batchSize)
// valuesArr.fill(sendValue)

var stopSigSql='SELECT sig FROM ' + controllSigTable + ' WHERE type= \'stop\'; '
var shutdownSigSql='SELECT sig FROM ' + controllSigTable + ' WHERE type= \'shutdown\'; '

// 合约地址里面要有bo，调用的时候实际是花的合约里面的代币， controller里面要有足够的以太零，用作维持交易频率

class RepeatBatchSendCoin {
  constructor (){
    this.maxSendAmount = maxPendingTx //合约调用的队列大小， 最多存在5笔处于pendding的调用
    this.currentPendingAmount = 0
    this.intervalId = 0
    this.arr = []
    this.total = 0
    this.finished = 0
    this.sended = 0
    // this.finishState = false
    this.maxId=0

    //控制参数
    this.stopSig=false //不再刷新arr
    this.shutdownSig=false //不再发交易

    this.onSended = (sendingIdArrayStr) => {
      return (txhash) => {
        var updateRevertSql="UPDATE "+table_name+" SET updateAt='now(), ,txHash='" + txhash + "' WHERE id IN ("+sendingIdArrayStr+ ") AND state = 1";
        this.client.query(updateRevertSql).catch(e => {
          // console.log(e);
          logger.error(JSON.stringify(e));
          logger.error('txHash update pending error: '+ txhash, 'datebaseUpdate');
        })
      }
    }

    this.onError = (sendingIdArrayStr) => {
      var doerror = (error) => {
        logger.error('transactionError: '+error, 'transaction state');
        var updateRevertSql="UPDATE "+table_name+" SET state='3', updateAt='now()' WHERE id IN ("+sendingIdArrayStr+ ")";
        this.client.query(updateRevertSql).catch(e => {
          // console.log(e);
          logger.error(JSON.stringify(e));
          logger.error('txHash store error: '+ receipt.transactionHash, 'datebaseUpdate');
        })
        this.currentPendingAmount--
        this.finished++
      }
      // logger.info(sendingAddrArrayStr)
      return doerror
    }

    this.onSuccess = (sendingIdArrayStr) => {
      var dosucess = (confNumber, receipt) => {
        // logger.info('transaction comfirm: '+ JSON.stringify(receipt), 'transaction state')
        var updateSuccessSql="UPDATE "+table_name+" SET state='2', updateAt='now()' ,txHash='" + receipt.transactionHash + "' WHERE id IN ("+sendingIdArrayStr + ")";
        this.client.query(updateSuccessSql).catch(e => {
          logger.error('txHash store error: '+ receipt.transactionHash, 'datebaseUpdate');
        })
        this.finished++
        this.currentPendingAmount--
        logger.info('finished: '+this.finished);
      }
      // logger.info(sendingAddrArrayStr)
      return dosucess
    }
  }

  refreshState() {
    this.arr = []
    this.total = 0
    this.finished = 0
    this.sended = 0
  }

  async collectAddressToSend() {
    var currentMaxId = (await this.client.query('SELECT max(id) as maxid FROM '+table_name+' WHERE state=0')).rows[0].maxid
    if (!currentMaxId) {
      currentMaxId=this.maxId
    }
    var res = await this.client.query('SELECT * FROM '+table_name+' WHERE state=0 AND id > '+this.maxId+' AND id <= '+currentMaxId)
    this.maxId = currentMaxId
    this.arr = res.rows
    this.total = this.arr.length
    logger.info('start again maxId: '+this.maxId+' sendCount: '+this.total)
  }

  async sendcoin() {
    if (this.currentPendingAmount < this.maxSendAmount && !this.shutdownSig) {
      if (this.sended < this.total) {
        try {
          var willFinishIndex = ((this.sended + batchSize) >this.total)? this.total: this.sended+batchSize
          var sendingAddrArray = this.arr.slice(this.sended, willFinishIndex).map(function(row){ return row.address})
          // var sendingAddrArrayStr = sendingAddrArray.map(function(address){ return '\'' + address + '\'' })
          var valuesArr = this.arr.slice(this.sended, willFinishIndex).map(function(row){ return row.value})
          var sendingIdArrayStr = this.arr.slice(this.sended, willFinishIndex).map(function(row){ return '\'' + row.id + '\''})
          this.sended=willFinishIndex
          var data =airdropContract.methods['multiSend(address,address[],uint256[])'](tokenAddress, sendingAddrArray, valuesArr).encodeABI();
          var txObject = await web3.eth.accounts.signTransaction({
            to: airdropAddress,
            data: data,
            gas: 2000000, //100个地址的话差不多时两百万左右，具体可以测试的时候看下交易的gas used做调整
            nonce: this.nonce++,
          },privateKey)
          this.currentPendingAmount++
          web3.eth.sendSignedTransaction(txObject.rawTransaction)
          .once('transactionHash', this.onSended(sendingIdArrayStr))
          .once('confirmation', this.onSuccess(sendingIdArrayStr))
          .once('error', this.onError(sendingIdArrayStr))
          var updatePendingSql="UPDATE "+table_name+" SET state='1', updateAt='now()' WHERE id IN ("+sendingIdArrayStr+ ')';
          // logger.info('txhash in sign: ' + txObject.rawTransaction + ' '+ sendingAddrArrayStr)
          await this.client.query(updatePendingSql)
          this.client.query(shutdownSigSql).then((res) => {
            if (res.rows[0].sig==1) {
              this.shutdownSig=true
            }
          })
          logger.info('sended coin: '+ this.sended)
        } catch (e) {
          console.log(e);
          logger.error('unhandle eception1: ' +JSON.stringify(e));
        }
      }  else {
        try {
          let stopres = await this.client.query(stopSigSql)
          if (stopres.rows[0].sig==1) {
            this.stopSig=true
          }
        } catch (e) {
          logger.error('error in getting sig: '+e);
        }
        if (!this.stopSig) {
          var res = await this.client.query('SELECT * FROM '+table_name+' WHERE state=0 AND id > '+this.maxId)
          if (res.rows && res.rows.length && (res.rows.length > minSendTrigger)) {
            this.refreshState()
            await this.collectAddressToSend()
            var startBalance = await airdropContract.methods.balanceIn(tokenAddress).call()
            logger.info('start at balance: '+ startBalance);
          }
        }
      }
    }
  }

  async start() {
    this.client = new Client(conString)
    await this.client.connect()
    await this.collectAddressToSend()
    this.nonce = await web3.eth.getTransactionCount(controllerAddress)
    var startBalance = await airdropContract.methods.balanceIn(tokenAddress).call()
    logger.info('start at balance: '+ startBalance);
    this.intervalId = setInterval(this.sendcoin.bind(this), interval)
  }
}

var task = new RepeatBatchSendCoin()
task.start()
