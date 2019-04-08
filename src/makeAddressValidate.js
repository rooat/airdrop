//@flow
const { Client } = require('pg')
const conString = "tcp://postgres:etz.123456@localhost/blockoptions"
var Web3 = require('web3')
var web3 = new Web3(new Web3.providers.WebsocketProvider("ws://127.0.0.1:8546"));
const logger = require('./logger')
const table_name = 'air_drop_20180621';

start = async() => {
  this.client = new Client(conString)
  await this.client.connect()
  var res = await this.client.query('SELECT * FROM '+table_name)
  for (var i = 0; i < res.rows.length; i++) {
    let cur = res.rows[i]
    if (!web3.utils.checkAddressChecksum(cur.address)) {
      console.log('address invalid so change: '+ cur.address)
      try {
        await this.client.query("UPDATE "+table_name+" SET address='" + web3.utils.toChecksumAddress(cur.address.toLocaleLowerCase()) + "' WHERE address='"+cur.address+"'")
      } catch (e) {
        console.log(e);
        // logger.error('deleting duplicte address: ' + cur.address);
        // await this.client.query("DELETE FROM " + table_name + " WHERE address = '"+ cur.address+ "' ;")
      }
    }
  }
}

start()
