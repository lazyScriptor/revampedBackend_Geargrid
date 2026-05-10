import app from "./src/app.js";
app._router.stack.forEach(function(r){
  if (r.route && r.route.path){
    console.log(r.route.path)
  } else if (r.name === 'router') {
    console.log("Router mounted at: " + r.regexp)
  }
})
