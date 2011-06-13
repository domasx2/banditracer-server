var ws = require("websocket-server");

var server = ws.createServer();

server.listen(6700);

server.addListener("request", function(req, res){
  res.writeHead(200, {"Content-Type": "text/plain"});
  res.write("okay");
  res.end();
});


server.addListener("/websocket", function(conn){
  log('hu');
  log(conn._id + ": new connection");
  conn.addListener("readyStateChange", function(readyState){
    log("stateChanged: "+readyState);
  });
 
  conn.addListener("open", function(){
    log(conn._id + ": onOpen");

  });
 
  conn.addListener("close", function(){
    var c = this;
    log(c._id + ": onClose");

  });
 
  conn.addListener("message", function(message){
    log(conn._id + ": "+message);
  });
});

log('started');