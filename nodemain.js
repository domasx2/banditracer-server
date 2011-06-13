var sys = require("sys"), ws = require('node-websocket-server');

var server = ws.createServer();

var combatserver=require('./combatserver');
var cserver=new combatserver.CombatServer('node');




server.addListener("connection", function(conn){
  console.log(conn._id + ": new connection");
  conn.addListener("readyStateChange", function(readyState){
    console.log("stateChanged: "+readyState);
  });
 
  conn.addListener("open", function(){
    console.log(this._id + ": onOpen");

  });
 
  conn.addListener("close", function(){
    var c = this;
    console.log(this._id + ": onClose");
    if(this.player)this.player.disconnect();

  });
 
  conn.addListener("message", function(message){
   // console.log(this._id + ": "+message);
    var retv=cserver.handle(message, conn);   
  });
});
server.listen(8000);
console.log('started');