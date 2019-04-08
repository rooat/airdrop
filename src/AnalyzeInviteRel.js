//@flow
const { Client } = require('pg')
const logger = require('./AnalyzeLogger');
const conString = "tcp://postgres:etz.123456@localhost/blockoptions"
const table_name = 'etz_recommend_record';

var m = {};
var addrToInviteCode = {}

async function fillMap() {
  var client = new Client(conString)
  await client.connect()
  var res = await client.query("SELECT lower(phone_address) AS phone_address, lower(recommend_address) AS recommend_address FROM " +table_name + " where type='推荐奖励' AND status='已激活' AND lower(phone_address) <> lower(recommend_address)")
  for (var index = 0; index < res.rows.length; index++) {
    m[res.rows[index].phone_address] = {pre: res.rows[index].recommend_address, count: 0}
    if (res.rows[index].recommend_address && !m[res.rows[index].recommend_address]) {
      m[res.rows[index].recommend_address] = {pre: null, count: 0}
    }
  }
  res = await client.query("select receive_address, invite_code from etz_userinfo")
  for (var i = 0; i < res.rows.length; i++) {
    if (res.rows[i].invite_code && res.rows[i].receive_address) {
      addrToInviteCode[res.rows[i].receive_address] = res.rows[i].invite_code
    }
  }
  client.end()
  console.log(res.rows.length)
}

async function analyzeMap() {
  for (var address in m) {
    console.log(address)
    var curAddr = address
    while (m[curAddr].pre) {
      curAddr = m[curAddr].pre
      m[curAddr].count += 1
    }
  }
  console.log('finish analyze')
}

async function start(){
  await fillMap()
  await analyzeMap()
  var client = new Client(conString)
  await client.connect()
  for (var address in m) {
    // console.log(address)
    if (m[address].count>0) {
      logger.info(addrToInviteCode[address] + ':' + m[address].count)
    }
  }
  // process.exit(0)
}

start()

