var {Application} = require("stick");

export("app", "init");
var combatserver=require('./combatserver');
var app = Application();
app.configure("notfound", "error", "static", "params", "mount");
app.static(module.resolve("public"));
app.mount("/", require("./actions"));

var server;
var cserver;
var start = function() {
   
   
   // see https://gist.github.com/555596
   var context = server.getDefaultContext();
   cserver=new combatserver.CombatServer('ringo');
  // print ('starting it', context.addWebSocket);
   context.addWebSocket("/", function (socket) {
      // export socket to let us play with it
      exports.socket = socket;
      print('new connection');
      socket.onopen=function(){
         print('open');
      };
      
      socket.onmessage = function(m) {
        // print("MESSAGE", m);
         var retv=cserver.handle(m, socket);
      };

      socket.onclose = function() {
         if(this.player)this.player.disconnect();
         print("CLOSE");
      };
   });
   return;
};

// Script run from command line
if (require.main === module) {
   server = require("ringo/httpserver").main(module.id);
   start();
}
