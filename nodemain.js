var WebSocketServer = require('websocket').server;
var settings=require('./settings');
var http = require('http')

var combatserver=require('./combatserver');
var cserver=new combatserver.CombatServer('node');

var port=settings.PORT;

var server = http.createServer(function(request, response){
	response.writeHead(404);
    response.end();
});

server.listen(port, function() {
    console.log((new Date()) + ' Server is listening on port '+port);
});


wsServer = new WebSocketServer({
    httpServer: server,
    autoAcceptConnections: false
});


wsServer.on('request', function(request) {
    var connection = request.accept('banditracer', request.origin);
    console.log((new Date()) + ' Connection accepted.');
    connection.on('message', function(message) {   	
        if (message.type === 'utf8') {
            var retv=cserver.handle(message.utf8Data, connection);
        }
        else if (message.type === 'binary') {
            console.log('Received Binary Message of ' + message.binaryData.length + ' bytes');
        }
    });
    connection.on('close', function(reasonCode, description) {
    	var c = this;
    	// console.log(this._id + ": onClose");
	    if(this.player){
	      cserver.log('CLOSE: '+this.player.uid);
	      this.player.disconnect();
	    }
    });
});

