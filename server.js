const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const rooms = new Map();

const server = http.createServer((req,res)=>{
  let p = req.url === "/" ? "/index.html" : req.url;
  const file = path.join(__dirname, "public", p);
  if (!file.startsWith(path.join(__dirname,"public"))){ res.writeHead(403); return res.end(); }
  fs.readFile(file,(err,data)=>{
    if(err){res.writeHead(404);return res.end("Not found");}
    const ext=path.extname(file);
    const type={".html":"text/html",".js":"text/javascript",".css":"text/css"}[ext]||"text/plain";
    res.writeHead(200,{"Content-Type":type});res.end(data);
  });
});

const wss = new WebSocket.Server({server});

function code(){ return Math.random().toString(36).slice(2,7).toUpperCase(); }
function send(ws,msg){ if(ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(msg)); }
function broadcast(room,msg){ room.players.forEach(p=>send(p.ws,msg)); }

wss.on("connection",ws=>{
  ws.on("message",raw=>{
    let m; try{m=JSON.parse(raw)}catch{return}
    if(m.type==="create"){
      let c=code(); while(rooms.has(c)) c=code();
      const room={code:c,players:[],challenge:null,used:[],turn:0,started:false};
      room.players.push({ws,name:m.name||"Player 1",score:0});
      rooms.set(c,room); ws.room=c;
      send(ws,{type:"room",code:c,player:0,players:room.players.map(p=>({name:p.name,score:p.score}))});
    }
    if(m.type==="join"){
      const room=rooms.get(String(m.code||"").toUpperCase());
      if(!room) return send(ws,{type:"error",message:"Room not found."});
      if(room.players.length>=2) return send(ws,{type:"error",message:"That room is full."});
      room.players.push({ws,name:m.name||"Player 2",score:0}); ws.room=room.code;
      broadcast(room,{type:"players",players:room.players.map(p=>({name:p.name,score:p.score}))});
      broadcast(room,{type:"ready"});
    }
    const room=rooms.get(ws.room); if(!room) return;
    if(m.type==="challenge" && room.players.length===2){
      room.challenge=m.challenge; room.turn=m.turn; broadcast(room,{type:"challenge",challenge:m.challenge,turn:room.turn});
    }
    if(m.type==="score"){
      const p=room.players[m.player]; if(!p) return;
      p.score+=Number(m.points)||0;
      room.turn=1-m.player;
      broadcast(room,{type:"state",players:room.players.map(x=>({name:x.name,score:x.score})),turn:room.turn});
      if(p.score>=50) broadcast(room,{type:"winner",player:m.player});
    }
  });
  ws.on("close",()=>{
    const room=rooms.get(ws.room); if(!room)return;
    room.players=room.players.filter(p=>p.ws!==ws);
    if(!room.players.length) rooms.delete(room.code);
    else broadcast(room,{type:"left"});
  });
});

server.listen(PORT,()=>console.log(`Us vs Us 2.0 running on port ${PORT}`));
