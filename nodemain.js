var ws = require('node-websocket-server');
var settings=require('./settings');
var server = ws.createServer();

var combatserver=require('./combatserver');
var cserver=new combatserver.CombatServer('node');

var port=settings.PORT;

server.addListener("connection", function(conn){
  conn.addListener("readyStateChange", function(readyState){
    console.log("stateChanged: "+readyState);
  });
 
  conn.addListener("open", function(){
    //console.log(this._id + ": onOpen");

  });
 
  conn.addListener("close", function(){
    var c = this;
   // console.log(this._id + ": onClose");
    if(this.player){
      cserver.log('CLOSE: '+this.player.uid);
      this.player.disconnect();
    }

  });
 
  conn.addListener("message", function(message){
   // console.log(this._id + ": "+message);
    var retv=cserver.handle(message, conn);   
  });
  
  conn.addListener('error', function (exc) {
    cserver.log("ignoring exception: " + exc);
  });
});
server.listen(port);
cserver.log('SERVER STARTED, LISTENING '+port);