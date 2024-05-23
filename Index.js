const fs = require("fs");
const url = require("url");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const querystring = require("querystring");

let languageop=[ //all languages and their keys used for currentsAPI
    {full:"arabic",key: "ar"},{full:"chinese",key: "zh"},{full:"dutch",key: "nl"},{full:"english",key: "en"},
    {full:"finnish",key: "fi"},{full:"french",key: "fr"},{full:"german",key: "de"},{full:"hindi",key: "hi"},
    {full:"italian",key: "it"},{full:"japanese",key: "ja"},{full:"korean",key: "ko"},{full:"malay",key: "msa"},
    {full:"portugese",key: "pt"},{full:"russian",key: "ru"},{full:"spanish",key: "es"},{full:"vietnamese",key: "vi"},
    {full:"danish",key: "da"},{full:"czech",key: "cs"},{full:"greek",key: "el"},{full:"hungarian",key: "hu"},
    {full:"serbian",key: "sr"},{full:"thai",key: "th"},{full:"turkish",key: "tr"}
];

const news_credentials=require("./credentials");//apiKey for currents API
const {client_id,client_secret,redirect_uri,scope,response_type}=require("./credentials2");//all required inputs for Google/Google Docs API

const port = 3000;
const all_sessions = [];
const server = http.createServer();

server.on("listening", listen_handler);
server.listen(port);
function listen_handler() {
    console.log(`Now Listening on Port ${port}`);
}

server.on("request", request_handler);
function request_handler(req, res) {
    console.log(`New Request from ${req.socket.remoteAddress} for ${req.url}`);
    if (req.url === "/") {
        const form = fs.createReadStream("input.html");
        res.writeHead(200, {"Content-Type": "text/html"});
        form.pipe(res);
    } 
    else if (req.url.startsWith("/search")) {
        let {language}= url.parse(req.url,true).query;
        language=language.toLowerCase();        
        let langkey=languageop.find((o)=>o.full===language);//matches language input whether lowercase or uppercase to its key for the API
        if (langkey == null || langkey === "" || langkey==undefined) {
            not_found(res);
            return;
        }
        else{
            langkey=langkey.key;
        }
        const state = crypto.randomBytes(20).toString("hex");
        all_sessions.push({langkey, state});
      
        redirect_to_GoogleDocs(state, res);
    } 
    
    else if (req.url.startsWith("/oauth2callback")) {
       
        
        const user_input = new URL(req.url,`https://${req.headers.host}/oauth2callback`).searchParams;
        
        const {code}=url.parse(req.url,true).query;
        const {state}=url.parse(req.url,true).query;
       
        let session = all_sessions.find((session) => session.state === state);
        all_sessions.splice(all_sessions.indexOf(session.state),1);//remove session

        if (code === undefined || state === undefined || session === undefined) {
            not_found(res);
            return;
        }
        const {langkey} = session;

        send_access_token_request(code, langkey, res);
    } 
    else {
        not_found(res);
    }
}
function not_found(res){
	res.writeHead(404, {"Content-Type": "text/html"});
	res.end(`<h1>404 Not Found</h1>`);
}
function send_access_token_request(code, user_input, res) {
    const grant_type = "authorization_code";


    const token_endpoint = "https://oauth2.googleapis.com/token";
    let post_data=new URLSearchParams({client_id, client_secret, code,redirect_uri,grant_type}).toString();
   
    let options = {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        }
    };
   
   
    https.request(token_endpoint, options, 
        (token_stream) => process_stream(token_stream, receive_access_token, user_input, res)
    ).end(post_data);
}
function process_stream(stream, callback, ...args) {
    let body="";
    stream.on("data", (chunk) => (body += chunk));
    stream.on("end", () => callback(body, ...args));
}

function receive_access_token(body, user_input, res) {
    const {access_token} = JSON.parse(body);
    console.log("ACCESS TOKEN "+access_token);
    get_latest_news(user_input, access_token, res);
}
function get_latest_news(user_input, access_token, res) {
    
    const news_endpoint = `https://api.currentsapi.services/v1/latest-news?language=${user_input}`;
    const news_request = https.request(news_endpoint, {method: "GET", headers: news_credentials});
    news_request.on("response", (stream) => process_stream(stream, organize_news, user_input, access_token, res));
    news_request.end();
}
function organize_news(body, langkey, access_token, res) {
    let news_object = JSON.parse(body);
   
    let news = news_object.news;
    let count=0;
	let results = news.map(format_news).join('');
   
    if (news.length == 0) {
        res.end("No Results Found");
        return;
    }
    create_doc(results, langkey, access_token, res);
    function format_news(news) {
        while(count<5){
            let news_title=news.title;
            let news_description=news.description;
            let url= news.url;
            let author=news.author;
           
            count++;
            return `Article Title\n ${news_title} \nDescription\n ${news_description} \nAuthor\n ${author} \nURL ${url}\n`
        }
        
    }
}
function create_doc(news, langkey, access_token, res) {
    const doc_endpoint = "https://docs.googleapis.com/v1/documents"; //access document create endpoint
    const options = {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${access_token}`,
        },
        
    };
    let language=languageop.find((o)=>o.key===langkey).full;
    language[0]=language[0].toUpperCase();
    const post_data=JSON.stringify({
        title:`Top 5 News Articles in ${language}`,
       
    });
   
    const createDoc_req = https.request(doc_endpoint, options);

    createDoc_req.on("response", (stream) => process_stream(stream, doc_creation_response, news, access_token, res));
    createDoc_req.end(post_data);
}
function doc_creation_response(body, news, access_token, res) {
    console.log(JSON.parse(body));
    const {documentId: documentId} = JSON.parse(body); //get the newly created documentId provided by google
    console.log("DOCUMENT ID: "+documentId);
    docBatchUpdate(news, documentId, access_token, res);
}
function docBatchUpdate(news,documentId,access_token,res){
    const getDoc_endpoint=`https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`; //access batchUpdate endpoint
    const options ={
        method:"POST",
        headers:{
            "Content-Type": "application/json",
            Authorization: `Bearer ${access_token}`
        }
    };

    const updateData=JSON.stringify({
        "requests":[
            {
                "insertText":{
                    "text": `${news}`,  //input currentsAPI data
                    "location":{
                        "index":1
                    }
                }
            }
        ],
    }
    )
    const getDoc_request=https.request(getDoc_endpoint,options);
    getDoc_request.on("response",(stream)=>process_stream(stream,docBatchUpdate_response,news,documentId,access_token,res));
    getDoc_request.end(updateData);
}
function docBatchUpdate_response(docbody,news,documentID,access_token,res){
    console.log(JSON.parse(docbody));
    res.writeHead(302, {Location: `https://docs.google.com/document/d/${documentID}`}).end(); //send user to their google docs document

}
function redirect_to_GoogleDocs(state, res) {
    const authorization_endpoint = " https://accounts.google.com/o/oauth2/v2/auth";
    let uri = new URLSearchParams({state, client_id, scope,redirect_uri,response_type}).toString();
    res.writeHead(302, {Location: `${authorization_endpoint}?${uri}`}).end();
    
}