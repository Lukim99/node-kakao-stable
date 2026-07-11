const express = require('express');
const server = express();
server.all('/',(req,res)=>{
  res.send("카카오톡 봇 온라인");
})
function keepAlive() {
  server.listen(3000, ()=>{ console.log("서버 준비 완료!") })
}
module.exports = keepAlive;