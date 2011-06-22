var world=require('./client/javascript/world');
var settings=require('./settings');
var game_settings=require('./client/javascript/settings');
var car_descriptions=require('./client/javascript/car_descriptions');
var TIMER_LASTCALL = null;
var CALLBACKS = {};
var CALLBACKS_LASTCALL = {};
var TIMER = null;
var STARTTIME = null;
var fs=require('fs');
var PHYS_SCALE=game_settings.get('PHYS_SCALE');
var TILE_SCALE=game_settings.get('TILE_SCALE');


var fpsCallback = function(fn, thisObj, fps) {
   fps = parseInt(1000/fps, 10);
   if (CALLBACKS[fps] === undefined) CALLBACKS[fps] = [];
   if (CALLBACKS_LASTCALL[fps] === undefined) CALLBACKS_LASTCALL[fps] = 0;

   CALLBACKS[fps].push({
      'rawFn': fn,
      'callback': function(msWaited) {
         fn.apply(thisObj, [msWaited]);
      }
   });
   return;
};

var perInterval = function() {
   var msNow = Date.now();
   var lastCalls = CALLBACKS_LASTCALL;
   for (var fpsKey in lastCalls) {
      if (!lastCalls[fpsKey]) {
         CALLBACKS_LASTCALL[fpsKey] = msNow;
      }
      var msWaited = msNow - lastCalls[fpsKey];
      if (fpsKey <= msWaited) {
         CALLBACKS_LASTCALL[fpsKey] = msNow;
         CALLBACKS[fpsKey].forEach(function(fnInfo) {
            fnInfo.callback(msWaited);
         }, this);
      }
   }
   return;
};






function genPlayerUID() {
    //http://note19.com/2007/05/27/javascript-guid-generator/
    //not a real UID!
    var S4 = function() {
       return (((1+Math.random())*0x10000)|0).toString(16).substring(1);
    };
    return (S4()+S4()+"-"+S4()+"-"+S4()+"-"+S4()+"-"+S4()+S4()+S4());
}

var GAME_STATUS_WAITING=1;
var GAME_STATUS_LOADING=2;
var GAME_STATUS_RUNNING=3;

var Game=exports.Game=function(id, track, leader, server){
    this.id=id;
    this.type='game';
    this.track=track;
    this.level=server.levels[track];
    this.leader=leader;
    this.players={};
    this.server=server;
    this.status=GAME_STATUS_WAITING;
    this.time=0;
    this.force_start_after=20000;
    this.time_to_start=3001;
    this.world=null;
    this.max_laps=3;
    this.finishers=[];
    this.send_update_flip=true; //sending upates every second frame, flipping this to track.
    server.log('START GAME '+id);

    this.updatePlayer=function(player, payload){
        player.car.steer=payload.actions.steer;
        player.car.accelerate=payload.actions.accelerate;
        player.car.fire_weapon1=payload.actions.fire_weapon1;
        player.car.fire_weapon2=payload.actions.fire_weapon2;
        player.last_event_no=payload.eventno;
    };

    this.update=function(msDuration){
        var uid, player;

        //wait to be started
        if(this.status===GAME_STATUS_WAITING) return;
        //no players left - destroy
        if(this.countPlayers()==0){
            this.server.log('NO PLAYERS LEFT '+this.id);
            this.destroy();
            return;
        }

        this.time+=msDuration;


        //timeout game?
        if(this.time>settings.GAME_TIMEOUT){
            this.server.log('GAME TIMEOUT '+this.id);
            this.destroy();
        }

        var update_start=(new Date()).getTime();

        //start the game when all players report ready OR 6 seconds have passed
        var ready=true;
        for(uid in this.players){
            if(!this.players[uid].ready){
                ready=false;
                break;
            }
        }
        if(ready){
            this.status=GAME_STATUS_RUNNING;

        //if timeout time has passed, kick unready players and start anyway
        }else if(this.time>this.force_start_after){
            for(uid in this.players){
                this.removePlayer(this.players[uid], 'Timed out!');
            }
            this.status=GAME_STATUS_RUNNING;
        };

        if(this.status===GAME_STATUS_RUNNING){
            if(this.time_to_start> -1000){
                this.time_to_start-=msDuration;
                if(this.time_to_start<0)this.started=true;
            }

            if(this.started){
                this.world.b2world.Step(msDuration/1000, 10, 8);
                this.world.update(msDuration);
            }
        }
        var finished=true;
        for(uid in this.players){
            player=this.players[uid];
            if(player.car.lap>this.max_laps && (!player.finished)){
                player.finished=true;
                player.car.teleport([0, 0]);
                player.car.active=false;
                this.finishers.push(player);
            }
            if(!player.finished)finished=false;
        }

        if(finished){
            var table=[];
            for(var i=0;i<this.finishers.length;i++){
                table.push({'place':String(i+1),
                           'id':this.finishers[i].id,
                           'player':this.finishers[i].alias,
                           'kills':String(this.finishers[i].car.kills),
                           'deaths':String(this.finishers[i].car.deaths)});
            }

            this.pushResponse(this.server.newResponse('GAME_OVER', {'table':table}));
            this.server.log('GAME FINISHED '+this.id);
            this.destroy('', true);

        }
        if(this.send_update_flip) this.pushUpdates(update_start);
        this.send_update_flip=this.send_update_flip ? false : true;
    };

   this.stringifyResponse=function(events, states, t, carid, tts){
      return ['{"cmd":"GAME_UPDATE", "payload":{"carid":'+carid, ',"tts":'+tts, ',"t":'+t, ',"states":', states, ',"events":[', events.join(','), ']}}'].join('');
   };

    this.pushUpdates=function(update_start){
      try{

        var player, obj, objid, state;
        var states={};
        //gen object states

        for(objid in this.world.object_by_id){
            var obj=this.world.object_by_id[objid];
            state=obj.getState();
            if(state){
                states[objid]=state;
            }
        }
        states=JSON.stringify(states);
        for(var uid in this.players){
            player=this.players[uid];
            //if(player.upds_stacked<5){

                var events=[];
                //add events player does not know yet
                var eno=player.last_event_no+1;
                while(this.world.events[eno]){
                    if(!this.world.events[eno].json)this.world.events[eno].json=JSON.stringify(this.world.events[eno]);
                    events[events.length]=this.world.events[eno].json;
                    eno++;
                }
                player.last_event_no=eno-1;
                player.send(this.stringifyResponse(events, states, this.time+(new Date()).getTime()-update_start, player.car.id,this.time_to_start));


                /*player.send(server.newResponse('GAME_UPDATE', {'states':events,
                                                                't':this.time+(new Date()).getTime()-update_start,
                                                               'events':events,
                                                               'carid':player.car.id,
                                                               'tts':this.time_to_start}));*/
                player.upds_stacked++;
           // }
        };

        }catch(e){this.server.log(e);}
    };

    this.addPlayer=function(player){
        this.players[player.uid]=player;
        player.game=this;
        player.ready=false;
        player.last_event_no=0;
        player.finished=false;
        this.server.log('GAME PLAYER JOINED '+player.uid);
    };

    this.pushResponse=function(response){
        for(var uid in this.players){
            this.players[uid].send(response);
        }
    };

    this.countPlayers=function(){
        var size = 0, id;
        for (var id in this.players) {
            if (this.players.hasOwnProperty(id)) size++;
        }
        return size;

    };

    this.destroy=function(text, silent){
        for(uid in this.players){
            this.removePlayer(this.players[uid], text, silent);
        }
        this.server.log('DESTROY GAME '+this.id);
        delete this.server.games[this.id];
    };

    this.removePlayer=function(player, text, silent){

        delete this.players[player.uid];
        player.game=null;
        this.server.log('GAME '+this.id+' PLAYER LEFT '+player.uid);
        //remove self from server if there are no more players

        //if player was leader, assign new leader
        if(this.leader===player){
            this.leader=null;
            for(var uid in this.players){
                this.leader=this.players[uid];
                break;
            }
        }
        if(!(silent==true)){
            var resp=this.server.newResponse();
            resp.payload.text=text ? text : '';
            resp.cmd='LEFT_GAME';
            player.send(resp);
        }
    };


    this.start=function(){

        var player, car, startpos;
        this.world=world.buildWorld(this.level, world.MODE_SERVER);
        var i=1;
        for(var uid in this.players){
            player=this.players[uid];
            startpos=this.world.start_positions[i];
            car=this.world.event('create', {'type':'car', 'obj_name':player.car, 'pars':{'position':[startpos.x+1, startpos.y+2],
                                                                                                        'angle':startpos.angle,
                                                                                                        'alias':player.alias,
                                                                                                        'weapon1':car_descriptions[player.car].main_weapon,
                                                                                                        'weapon2':'MineLauncher'}});

            player.car=car;
            car.player=player;
            i++;
        }
        this.pushResponse(this.server.newResponse('START_GAME', {'track':this.track}));
        this.status=GAME_STATUS_LOADING;
    }
};

var Lobby=exports.Lobby=function(id, title, track, leader, server){
    /*

    */
    this.id=id;
    this.type='lobby';
    this.title=title;
    this.track=track;
    this.leader=leader;
    var luid=leader.uid;
    this.players={};
    this.players[luid]=leader;
    this.state='idle';
    this.server=server;
    this.max_players=6;
    leader.game=this;

    this.server.log('START LOBBY '+this.id+' TRACK: '+this.track+' LEADER: '+this.leader.uid);

    this.getPlayerInfo=function(){
        var retv=[];
        for(var uid in this.players){
            retv[retv.length]={'player':this.players[uid].alias+(uid===this.leader.uid ? ' (leader)' : ''),
                               'car':car_descriptions[this.players[uid].car].name,
                               'id':this.players[uid].id};
        }
        return retv;
    };

    this.countPlayers=function(){
        var size = 0, id;
        for (var id in this.players) {
            if (this.players.hasOwnProperty(id)) size++;
        }
        return size;

    };


    this.update=function(msDuration){

    };

    this.getLobbyInfoResponse=function(player){
        var payload={'players':this.getPlayerInfo(),
                     'track':this.track,
                     'is_leader':this.leader.uid==player.uid ? true : false};
        return this.server.newResponse('LOBBY_INFO', payload);
    };

    this.pushUpdates=function(){

        for(var uid in this.players){
            this.server.log('PUSH UPDATES '+uid);
            this.players[uid].send(this.getLobbyInfoResponse(this.players[uid]));
        }
    };

    this.kick=function(player){
         this.server.log('PLAYER '+player.uid+' KICKED FROM LOBBY '+this.id);
          this.removePlayer(player, 'You have been kicked!');
    };

    this.removePlayer=function(player, text){

        delete this.players[player.uid];
        player.game=null;
        //remove self from server if there are no more players

        //if player was leader, assign new leader
        if(this.leader===player){
            for(uid in this.players){
                this.leader=this.players[uid];
                break;
            }
        }
        this.pushUpdates();

        var resp=this.server.newResponse();
        resp.payload.text=text ? text : '';
        resp.cmd='LEFT_LOBBY';
        player.send(resp);
        this.server.log('PLAYER '+player.uid+' LEFT LOBBY '+this.id);

        if(this.countPlayers()===0){
            this.destroy();
            this.server.log('DESTROY LOBBY'+this.id)
            return;
        }
    };

    this.addPlayer=function(player){
        if(this.countPlayers()>=this.max_players){
            player.send(this.server.error('Lobby full.'));
        }else{
            this.players[player.uid]=player;
            player.game=this;
            player.send(this.server.newResponse('JOIN_LOBBY_OK', {'lobby_id':this.id}))
            this.pushUpdates();
            this.server.log('PLAYER '+player.uid+' JOINED LOBBY '+this.id);
        }
    };

    this.destroy=function(text){
        for(uid in this.players){
            this.players[uid].leave(text);
        }
        delete this.server.lobbies[this.id];
        this.server.log('DESTROY LOBBY '+this.id);
    };

    this.getLobbyListInfo=function(){

        return    {'title':this.title,
                  'id':this.id,
                  'track':this.track,
                  'playercount':this.countPlayers()+'/'+this.max_players};

    };
};


var Player=exports.Player=function(uid, id, alias, server){
    this.id=id;
    this.uid=uid;
    this.alias=alias;
    this.state='idle';
    this.socket=null;
    this.game=null;
    this.server=server;
    this.car='Racer';
    this.last_event_no=0;
    this.upds_stacked=0;
    this.ready=false;
    this.finished=false;
    this.idle=0; //seconds idle

    this.send=function(message){
        if(this.state!='disconnected'){
            if(!(typeof(message)=='string')){
               message=JSON.stringify(message);
            }
            try{

             //  var n1=(new Date()).getTime();
               this.socket.send ? this.socket.send(message) : this.socket.write(message);
            }catch(e){
               this.server.log('SEND FAIL:'+this.uid+' ERR:'+e);
               this.disconnect();
            }
        }
    };

    this.disconnect=function(){
        //disconnect: leave any game/lobby, remove self from server
        this.server.log("PLAYER DISCONNECTED: "+this.uid);
        this.state='disconnected';
        this.leave();
        delete this.server.players[this.uid];
        if(this.socket){
            try{
               this.socket.close();
            }catch(e){this.server.log('DCER:'+e);}
        }
    };

    this.update=function(msDuration){
         this.idle+=msDuration;
         if(this.idle>=settings.PLAYER_TIMEOUT){
            this.server.log('TIMEOUT '+this.uid);
            if(this.game)this.send(this.server.criticalError('Timeout!'));
            this.disconnect();
         }
    };

    this.touch=function(){
       this.idle=0;
    };

    this.leave=function(text){
        if(this.game)this.game.removePlayer(this, text);
    };
    this.server.log('NEW PLAYER '+this.uid+' AS '+this.alias);
};

exports.CombatServer=function(type){
    this.next_player_id=1;
    this.next_lobby_id=1;
    this.next_game_id=1;
    this.players={};
    this.games={};
    this.lobbies={};
    this.type=type;
    this.levels={};

    this.tickid=1;

    this.tick=function(msDuration){
        for(var lobbyid in this.lobbies){
            this.lobbies[lobbyid].update(msDuration);
        }
        for(var gameid in this.games){
            this.games[gameid].update(msDuration);
        }
        for(var uid in this.players){
            this.players[uid].update(msDuration);
        }
    };

    this.startTimer=function(){
        STARTTIME = Date.now();
        if(type=='ringo'){
            TIMER = require("ringo/scheduler").setInterval(perInterval, 10);
        }else{
            setInterval(perInterval, 10);
        }
        fpsCallback(this.tick, this, settings.UPDATES_PER_SECOND);

    };

    this.log=function(msg){
        if(this.type=='ringo'){
            print(msg);
        }else if (this.type=='node'){
            console.log(((new Date())+'').substr(0, 25)+msg);
        }
    }

    this.loadLevels=function(){
        if(this.type=='ringo'){

            var fnames=fs.list(settings.LEVEL_DIRECTORY);
            var levelname;
            var fname;
            var content;
            for(var i=0;i<fnames.length;i++){
                fname=fnames[i];
                levelname=fname.split('.')[0];
                content=fs.read(fs.join(settings.LEVEL_DIRECTORY, fname), 'r').trim();
                content=content.slice(13,content.length-1);
                this.levels[levelname]=JSON.parse(content);
            }
        }else if(this.type=='node'){
            var fnames=fs.readdirSync(settings.LEVEL_DIRECTORY);
            var levelname;
            var fname;
            var content;
            for(var i=0;i<fnames.length;i++){
                fname=fnames[i];
                levelname=fname.split('.')[0];
                content=fs.readFileSync(settings.LEVEL_DIRECTORY+'/'+fname, 'utf-8');
                content=content.slice(13,content.length-3);
                this.levels[levelname]=JSON.parse(content);
            }
        }

    };




    this.getPlayerByID=function(id){
        for(var uid in this.players){
            if(this.players[uid].id==id) return this.players[uid];
        }
        return null;
    };

    this.newResponse=function(cmd, payload){
        var resp= {'payload':{}};
        if(cmd)resp.cmd=cmd;
        if(payload)resp.payload=payload;
        return resp;
    };

    this.unsecured={'HI':true,
                    'PING':true}; //requests servicable without being logged in

    this.handle=function(message, socket){
        message=JSON.parse(message);
        message.socket=socket;
        var cmd=message.cmd;

        //assign player if possible
        if(message.uid){
            message.player=this.players[message.uid];
            if(message.player){
               message.player.touch();
            }
        }

        //set up response object
        var response=this.newResponse();

        if((!message.player)&&(!this.unsecured[cmd])){
            //if player is not registered and needs to be, alert
            response=this.criticalError('You must be registered.', this.newResponse());

        }else{
            //handle
            if(this['handle_'+cmd]){
                response=this['handle_'+cmd](message, response);
            }else{
               response=this.error('Unknown command:'+cmd);
            }
        }
        if(response){
            if(message.player) message.player.send(response);
            else{
                response=JSON.stringify(response)
               // this.log('SENDING'+response);
                socket.send ? socket.send(response) : socket.write(response);
            }
        }
        return null;
    };

    this.error=function(text){
        //error: alert the player
        this.log('ERROR: '+text);
        return this.newResponse('ERR', {'text':text});

    };

    this.criticalError=function(text){
        //critical error: alert the player, kick from lobby/game
        this.log('CRITICAL ERROR: '+text);
        return this.newResponse('CRITICAL_ERR', {'text':text});
    };

    /*
     LIST LOBBIES

    */
    this.handle_LIST_LOBBIES=function(message, response){
        var lobbyid;
        var info=[];
        for(lobbyid in this.lobbies){
            info[info.length]= this.lobbies[lobbyid].getLobbyListInfo();
        }
        response.payload.lobbies=info;
        response.cmd='LOBBY_LIST';
        return response;
    };

    /*
    GET LOBBY INFO
    */
    this.handle_GET_LOBBY_INFO=function(message, response){
        var lobby=message.player.game;
        if((!lobby) || (!(lobby.type=='lobby'))){
            return this.criticalError('Failed to get lobby info: you are not in a lobby!', response);
        }
        var resp= lobby.getLobbyInfoResponse(message.player);
        return resp;

    };



    /*
     CREATE LOBBY
    */
    this.handle_CREATE_LOBBY=function(message, response){
        var lobby=new Lobby(this.next_lobby_id++, message.payload.title, message.payload.track, message.player, this);
        this.lobbies[lobby.id]=lobby;
        response.payload.lobby_id=lobby.id;
        response.cmd='CREATE_LOBBY_OK';
        return response;
    };

    /*
    JOIN LOBBY
    */

    this.handle_JOIN_LOBBY=function(message, response){
        if(!this.lobbies[message.payload.lobby_id]){
            return this.error('Lobby not found.');
        };
        var lobby=this.lobbies[message.payload.lobby_id];
        lobby.addPlayer(message.player);
        return null;
    };


    /*
    KICK
    */
    this.handle_KICK=function(message, response){
        if(!this.lobbies[message.payload.lobby_id]){
            return this.error('Lobby not found.');
        }
        var lobby=this.lobbies[message.payload.lobby_id];
        if(!(message.player===lobby.leader)){
            return this.error('You are not lobby leader!');
        }
        var kickee=this.getPlayerByID(message.payload.player_id); //kickee, lol
        if(!lobby.players[kickee.uid]){
            return this.error('Player not in lobby.');
        }
        if(kickee===message.player){
            return this.error("You kicked yourself, oh so funny!.");
        }

        lobby.kick(kickee);
        return null;
    };

    /*
    LEAVE_LOBBY
    */
    this.handle_LEAVE_LOBBY=function(message, response){
        if(!(message.player.game&& (message.player.game.type=='lobby'))){
            return this.criticalError('You are not in a lobby.', response);
        }
        message.player.leave();
        return null;
    };

    /*
     START GAME

    */

    this.handle_START_GAME=function(message, response){
        if(!(message.player.game&& (message.player.game.type=='lobby'))){
            return this.criticalError('You are not in a lobby.');
        }
        if(!(message.player.game.leader===message.player)){
            return this.error('You are not the leader.');
        }
        var lobby=message.player.game;
        if(!(this.levels[lobby.track])){
            return this.error('Unknown track.');
        }

        var game=new Game(this.next_game_id++, lobby.track, lobby.leader, this);
        this.games[game.id]=game;
        for(var uid in lobby.players){
            game.addPlayer(lobby.players[uid]);
        };
        lobby.players={};
        lobby.leader=null;
        lobby.destroy();
        game.start();

        return null;
    };

    /*
    PLAYER REPORTS READY INGAME
    */
    this.handle_GAME_READY=function(message, response){
        if(message.player.game&&message.player.game.type=='game'&&message.player.game.status==GAME_STATUS_LOADING&&(!message.player.ready)){
            message.player.ready=true;
        }
    };

    /* PLAYER SENDS HIS UPDATES */
    this.handle_GAME_UPDATE=function(message, response){
        if((!message.player.game)||(!(message.player.game.type=='game'))){
           // return this.criticalError('Cannot update game state: you are not in a game!');
           return null;
        }
        message.player.game.updatePlayer(message.player, message.payload);
        return null;
    };

     /*
    HI
    register player
    */
    this.handle_HI=function(message, response){
        /*
        HI:
        registers player, returns id
        requires alias in message
        */

        if(!message.payload.alias){
           return this.error('Missing alias');
        }

        if(message.player){
            var player=message.player;
        }else{
            var uid=genPlayerUID();
            while(this.players[uid]) uid=genPlayerUID();
            var player=new Player(uid, this.next_player_id++, message.payload.alias, this);
            this.players[player.uid]=player;
        }
        player.socket=message.socket;
        message.socket=player;

        response.payload.uid=player.uid;
        response.cmd='HELLO';
        return response;
    };

        /*
    SELECT_CAR
    */
    this.handle_SELECT_CAR=function(message, response){
        if(!(car_descriptions.hasOwnProperty(message.payload.car))){
            return this.criticalError('Unknown car.');
        }
        message.player.car=message.payload.car;
        if(message.player.game && (message.player.game.type=='lobby')){
            message.player.game.pushUpdates();
        }
        return null;
    };

    /*PING */
    this.handle_PING=function(message, response){
        response.cmd='PONG';
        return response;
    };

    this.loadLevels();
    this.startTimer();

};
