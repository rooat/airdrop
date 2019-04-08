// ["0xa984D0105f4fb5080F9EB282a53EC0C0bC6c1Cb5","0x555312850B2151d13313d32249B4F83BCF26d8E5", "0x2BdC9353968f7Fb4C087B808D724E273f3f5F6b0", "0xd528f59bA06224204EABa1022b90894567333036"],10000000000000000
//@flow
const { Client } = require('pg')
var Web3 = require('web3');
var web3 = new Web3(new Web3.providers.WebsocketProvider("ws://etzrpc.org:2052"));
// const tokenABI = require('../config/tokenABI');
const ETZAirDropABI = require('../config/ETZAirDropABI');
const logger = require('./sendETZlogger');
const airdropAddress='0x62bc742c730d3e1df875f50b048f68f49f007006' //空投合约地址
const airDropMethod='multiSendBaseToken(address[],uint256)'
const controllerAddress=['0xdde459cf42d09446e4bae597e6508562213f30ea', '0xf158f1c9514a5b3c51a22dadeb6830d899ce9835', '0x87dc0f8e8aa63e5c27d851e8e1a6e734150bcf81'] //通过合约创建者调用空投的setController， 最好另外生成一个新的地址
const conString = "tcp://postgres:etz.123456@localhost/blockoptions"
const privateKey = ['', '', '']//controller的私钥
const table_name = 'air_drop_etz001';
const controllSigTable = table_name+'_controll_sig'
var airdropContract = new web3.eth.Contract(ETZAirDropABI, airdropAddress);
const batchSize = 30 //一次合约调用发送的数量, 例如现在是一次给一百个人发
const sendValue = 10000000000000000 //发送的金额
const maxPendingTx=1
const interval = 1000
const minSendTrigger = 5

// 合约地址里面要有bo，调用的时候实际是花的合约里面的代币， controller里面要有足够的以太零，用作维持交易频率

var stopSigSql='SELECT sig FROM ' + controllSigTable + ' WHERE type= \'stop\'; '
var shutdownSigSql='SELECT sig FROM ' + controllSigTable + ' WHERE type= \'shutdown\'; '

// 合约地址里面要有bo，调用的时候实际是花的合约里面的代币， controller里面要有足够的以太零，用作维持交易频率

class BatchSendETZ {
  constructor (){
    this.maxSendAmount = maxPendingTx //合约调用的队列大小， 最多存在5笔处于pendding的调用
    this.currentPendingAmount = 0
    this.intervalId = 0
    this.arr = []
    this.nonce = new Array(controllerAddress.length)
    this.isSending = false
    this.currentSender = 0
    this.total = 0
    this.finished = 0
    this.sended = 0
    this.errorNum = 0
    // this.finishState = false
    this.maxId=0

    //控制参数
    this.stopSig=false //不再刷新arr
    this.shutdownSig=false //不再发交易

    this.onSended = (sendingIdArrayStr) => {
      return (txhash) => {
        var updateRevertSql="UPDATE "+table_name+" SET updateAt='now()' ,txHash='" + txhash + "' WHERE id IN ("+sendingIdArrayStr+ ")";
        this.client.query(updateRevertSql).catch(e => {
          // console.log(e);
          logger.error(e.toString());
          logger.error('txHash update pending error: '+ txhash, 'datebaseUpdate');
        })
      }
    }

    this.onError = (sendingIdArrayStr) => {
      var doerror = (error) => {
        this.errorNum ++
        logger.error('transactionError: '+error, 'transaction state');
        var updateRevertSql="UPDATE "+table_name+" SET state='3', updateAt='now()' WHERE id IN ("+sendingIdArrayStr+ ")";
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
      // logger.info(sendingAddrArrayStr)
      return doerror
    }

    this.onSuccess = (sendingIdArrayStr) => {
      var dosucess = (confNumber, receipt) => {
        // logger.info('transaction comfirm: '+ JSON.stringify(receipt), 'transaction state')
        var updateSuccessSql="UPDATE "+table_name+" SET state='2', updateAt='now()' ,txHash='" + receipt.transactionHash + "' WHERE state IN (0,1) AND id IN ("+sendingIdArrayStr + ")";
        this.client.query(updateSuccessSql).catch(e => {
          logger.error('txHash store error: '+ receipt.transactionHash, 'datebaseUpdate');
        })
        this.finished++
        if (this.currentPendingAmount>0) {
          this.currentPendingAmount--
        }
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
    var currentMaxId = (await this.client.query('SELECT max(id) as maxid FROM '+table_name)).rows[0].maxid
    if (!currentMaxId || currentMaxId < this.maxId) {
      currentMaxId=this.maxId
    }
    var res = await this.client.query('SELECT * FROM '+table_name+' WHERE state=0 AND id > '+this.maxId+' AND id <= '+currentMaxId)
    this.maxId = currentMaxId
    this.arr = res.rows
    this.total = this.arr.length
    logger.info('start again maxId: '+this.maxId+' sendCount: '+this.total)
  }

  async sendcoin() {
    if (!this.isSending) {
      this.isSending = true
      try {
        if (this.currentPendingAmount < this.maxSendAmount && !this.shutdownSig) {
          this.currentSender++
          if (this.currentSender >= controllerAddress.length) {
            this.currentSender = 0
          }
          var beforePower = (new Date()).getTime()
          var power = await web3.eth.getPower(controllerAddress[this.currentSender])
          power = web3.utils.fromWei(power,'gwei')
          var afterPower = (new Date()).getTime()
          console.log('getPower: ' + (afterPower - beforePower));
          if (this.errorNum > 3) {
            this.nonce[this.currentSender] = await web3.eth.getTransactionCount(controllerAddress[this.currentSender])
            this.errorNum = 0
          }
          if (this.sended < this.total && power >  50000000) {
            var willFinishIndex = ((this.sended + batchSize) >this.total)? this.total: this.sended+batchSize
            var sendingAddrArray = this.arr.slice(this.sended, willFinishIndex).map(function(row){ return row.address})
            // var sendingAddrArrayStr = sendingAddrArray.map(function(address){ return '\'' + address + '\'' })
            var sendingIdArrayStr = this.arr.slice(this.sended, willFinishIndex).map(function(row){ return '\'' + row.id + '\''})
            this.sended=willFinishIndex
            var data =airdropContract.methods[airDropMethod](sendingAddrArray, sendValue).encodeABI();
            var beforeSign = (new Date()).getTime()
            console.log('calculate array: ' + (beforeSign-afterPower));
            var txObject = await web3.eth.accounts.signTransaction({
              to: airdropAddress,
              data: data,
              gas: 1500000, //100个地址的话差不多时两百万左右，具体可以测试的时候看下交易的gas used做调整
              nonce: this.nonce[this.currentSender]++,
            },privateKey[this.currentSender])
            var afterSign = (new Date()).getTime()
            console.log('sign: ' + (afterSign - beforeSign));
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
          } else {
            if (this.finished == Math.ceil(this.total/batchSize)) {
              logger.info('end at: ' + new Date().toLocaleString());
              console.log('finished!!!!!!!')
              this.finished = 0;
            }

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
                // var startBalance = await web3.eth.getBalance(controllerAddress[i])
                // logger.info('start at balance: '+ startBalance);
              }
            }
          }
        }
      } catch (e) {
        console.log(e);
        logger.error('unhandle eception1: ' +e.toString());
      }
      this.isSending = false
    }
  }

  async start() {
    this.client = new Client(conString)
    await this.client.connect()
    await this.collectAddressToSend()
    for (var i = 0; i < controllerAddress.length; i++) {
      this.nonce[i] = await web3.eth.getTransactionCount(controllerAddress[i])
    }
    // this.nonce = await web3.eth.getTransactionCount(controllerAddress)
    // var startBalance = await web3.eth.getBalance(controllerAddress)
    // logger.info('start at balance: '+ startBalance);
    // logger.info('start at: ' + new Date().toLocaleString())
    this.intervalId = setInterval(this.sendcoin.bind(this), interval)
  }
}

var task = new BatchSendETZ()
task.start()
