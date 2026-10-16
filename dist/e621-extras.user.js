// ==UserScript==
// @name        e621 extras
// @version     1.5.4
// @description Downvotes-to-blacklist manager, post tree viewer, hover zoom and tag scripts for regular members of e621 and e926.
// @namespace   e621-extras
// @author      Converter Script
// @match       https://e621.net/*
// @match       https://e926.net/*
// @grant       GM_setValue
// @grant       GM_getValue
// @grant       GM_listValues
// @grant       GM_deleteValue
// @grant       GM_xmlhttpRequest
// @grant       GM_registerMenuCommand
// @grant       GM_openInTab
// @run-at      document-end
// ==/UserScript==

console.log("Script start:",performance.now());const e=!0,t=e=>e,o="passthrough";let s,c={createHTML:t,createScript:t,createScriptURL:t},i=!1;const r=()=>{try{void 0!==window.isSecureContext&&window.isSecureContext&&window.trustedTypes&&window.trustedTypes.createPolicy&&(i=!0,trustedTypes.defaultPolicy?(l("TT Default Policy exists"),c=window.trustedTypes.createPolicy("default",c),s=trustedTypes.defaultPolicy,l(`Created custom passthrough policy, in case the default policy is too restrictive: Use Policy '${o}' in var 'TTP':`,c)):s=c=window.trustedTypes.createPolicy("default",c),l("Trusted-Type Policies: TTP:",c,"TTP_default:",s))}catch(e){l(e)}},l=(...e)=>{console.log(...e)};r();

(function() {
    // #region Logging
	
	  const SCRIPT_NAME = "e621 extras";
	  const _log = (...args) => {};
	  const _warn = (...args) => console.warn(`[${typeof SCRIPT_NAME === 'string' ? SCRIPT_NAME : '[USERSCRIPT_CONVERTED]'}]`, ...args);
	  const _error = (...args) => {
	    let e = args[0];
	    console.error(`[${typeof SCRIPT_NAME === 'string' ? SCRIPT_NAME : '[USERSCRIPT_CONVERTED]'}]`, ...args);
	  }
	  
    // #endregion
    // #region Unified Polyfill
	
// #region Messaging implementation
		
		function createEventBus(
		  scopeId,
		  type = "page", // "page" or "iframe"
		  { allowedOrigin = "*", children = [], parentWindow = null } = {}
		) {
		  if (!scopeId) throw new Error("createEventBus requires a scopeId");
		
		  const handlers = {};
		
		  function handleIncoming(ev) {
		    if (allowedOrigin !== "*" && ev.origin !== allowedOrigin) return;
		
		    const msg = ev.data;
		    if (!msg || msg.__eventBus !== true || msg.scopeId !== scopeId) return;
		
		    const { event, payload } = msg;
		
		    // PAGE: if it's an INIT from an iframe, adopt it
		    if (type === "page" && event === "__INIT__") {
		      const win = ev.source;
		      if (win && !children.includes(win)) {
		        children.push(win);
		      }
		      return;
		    }
		
		    (handlers[event] || []).forEach((fn) =>
		      fn(payload, { origin: ev.origin, source: ev.source })
		    );
		  }
		
		  window.addEventListener("message", handleIncoming);
		
		  function emitTo(win, event, payload) {
		    const envelope = {
		      __eventBus: true,
		      scopeId,
		      event,
		      payload,
		    };
		    win.postMessage(envelope, allowedOrigin);
		  }
		
		  // IFRAME: announce to page on startup
		  if (type === "iframe") {
		    setTimeout(() => {
		      const pw = parentWindow || window.parent;
		      if (pw && pw.postMessage) {
		        emitTo(pw, "__INIT__", null);
		      }
		    }, 0);
		  }
		
		  return {
		    on(event, fn) {
		      handlers[event] = handlers[event] || [];
		      handlers[event].push(fn);
		    },
		    off(event, fn) {
		      if (!handlers[event]) return;
		      handlers[event] = handlers[event].filter((h) => h !== fn);
		    },
		    /**
		     * Emits an event.
		     * @param {string} event - The event name.
		     * @param {any} payload - The event payload.
		     * @param {object} [options] - Emission options.
		     * @param {Window} [options.to] - A specific window to target. If provided, message is ONLY sent to the target.
		     */
		    emit(event, payload, { to } = {}) {
		      // If a specific target window is provided, send only to it and DO NOT dispatch locally.
		      // This prevents a port from receiving its own messages.
		      if (to) {
		        if (to && typeof to.postMessage === "function") {
		          emitTo(to, event, payload);
		        }
		        return; // Exit after targeted send.
		      }
		
		      // For broadcast messages (no 'to' target), dispatch locally first.
		      (handlers[event] || []).forEach((fn) =>
		        fn(payload, { origin: location.origin, source: window })
		      );
		
		      // Then propagate the broadcast to other windows.
		      if (type === "page") {
		        children.forEach((win) => emitTo(win, event, payload));
		      } else {
		        const pw = parentWindow || window.parent;
		        if (pw && pw.postMessage) {
		          emitTo(pw, event, payload);
		        }
		      }
		    },
		  };
		}
		
		function createRuntime(type = "background", bus) {
		  let nextId = 1;
		  const pending = {};
		  const msgListeners = [];
		
		  let nextPortId = 1;
		  const ports = {};
		  const onConnectListeners = [];
		
		  function parseArgs(args) {
		    let target, message, options, callback;
		    const arr = [...args];
		    if (arr.length === 0) {
		      throw new Error("sendMessage requires at least one argument");
		    }
		    if (arr.length === 1) {
		      return { message: arr[0] };
		    }
		    // last object could be options
		    if (
		      arr.length &&
		      typeof arr[arr.length - 1] === "object" &&
		      !Array.isArray(arr[arr.length - 1])
		    ) {
		      options = arr.pop();
		    }
		    // last function is callback
		    if (arr.length && typeof arr[arr.length - 1] === "function") {
		      callback = arr.pop();
		    }
		    if (
		      arr.length === 2 &&
		      (typeof arr[0] === "string" || typeof arr[0] === "number")
		    ) {
		      [target, message] = arr;
		    } else {
		      [message] = arr;
		    }
		    return { target, message, options, callback };
		  }
		
		  if (type === "background") {
		    bus.on("__REQUEST__", ({ id, message }, { source }) => {
		      let responded = false,
		        isAsync = false;
		      function sendResponse(resp) {
		        if (responded) return;
		        responded = true;
		        // Target the response directly back to the window that sent the request.
		        bus.emit("__RESPONSE__", { id, response: resp }, { to: source });
		      }
		      const results = msgListeners
		        .map((fn) => {
		          try {
		            // msg, sender, sendResponse
		            const ret = fn(message, { id, tab: { id: source } }, sendResponse);
		            if (ret === true || (ret && typeof ret.then === "function")) {
		              isAsync = true;
		              return ret;
		            }
		            return ret;
		          } catch (e) {
		            _error(e);
		          }
		        })
		        .filter((r) => r !== undefined);
		
		      const promises = results.filter((r) => r && typeof r.then === "function");
		      if (!isAsync && promises.length === 0) {
		        const out = results.length === 1 ? results[0] : results;
		        sendResponse(out);
		      } else if (promises.length) {
		        Promise.all(promises).then((vals) => {
		          if (!responded) {
		            const out = vals.length === 1 ? vals[0] : vals;
		            sendResponse(out);
		          }
		        });
		      }
		    });
		  }
		
		  if (type !== "background") {
		    bus.on("__RESPONSE__", ({ id, response }) => {
		      const entry = pending[id];
		      if (!entry) return;
		      entry.resolve(response);
		      if (entry.callback) entry.callback(response);
		      delete pending[id];
		    });
		  }
		
		  function sendMessage(...args) {
		    // Background should be able to send message to itself
		    // if (type === "background") {
		    //   throw new Error("Background cannot sendMessage to itself");
		    // }
		    const { target, message, callback } = parseArgs(args);
		    const id = nextId++;
		    const promise = new Promise((resolve) => {
		      pending[id] = { resolve, callback };
		      bus.emit("__REQUEST__", { id, message });
		    });
		    return promise;
		  }
		
		  bus.on("__PORT_CONNECT__", ({ portId, name }, { source }) => {
		    if (type !== "background") return;
		    const backgroundPort = makePort("background", portId, name, source);
		    ports[portId] = backgroundPort;
		
		    onConnectListeners.forEach((fn) => fn(backgroundPort));
		
		    // send back a CONNECT_ACK so the client can
		    // start listening on its end:
		    bus.emit("__PORT_CONNECT_ACK__", { portId, name }, { to: source });
		  });
		
		  // Clients handle the ACK and finalize their Port object by learning the remote window.
		  bus.on("__PORT_CONNECT_ACK__", ({ portId, name }, { source }) => {
		    if (type === "background") return; // ignore
		    const p = ports[portId];
		    if (!p) return;
		    // Call the port's internal finalize method to complete the handshake
		    if (p._finalize) {
		      p._finalize(source);
		    }
		  });
		
		  // Any port message travels via "__PORT_MESSAGE__"
		  bus.on("__PORT_MESSAGE__", (envelope, { source }) => {
		    const { portId } = envelope;
		    const p = ports[portId];
		    if (!p) return;
		    p._receive(envelope, source);
		  });
		
		  // Any port disconnect:
		  bus.on("__PORT_DISCONNECT__", ({ portId }) => {
		    const p = ports[portId];
		    if (!p) return;
		    p._disconnect();
		    delete ports[portId];
		  });
		
		  // Refactored makePort to correctly manage internal state and the connection handshake.
		  function makePort(side, portId, name, remoteWindow) {
		    let onMessageHandlers = [];
		    let onDisconnectHandlers = [];
		    let buffer = [];
		    // Unique instance ID for this port instance
		    const instanceId = Math.random().toString(36).slice(2) + Date.now();
		    // These state variables are part of the closure and are updated by _finalize
		    let _ready = side === "background";
		
		    function _drainBuffer() {
		      buffer.forEach((m) => _post(m));
		      buffer = [];
		    }
		
		    function _post(msg) {
		      // Always use the 'to' parameter for port messages, making them directional.
		      // Include senderInstanceId
		      bus.emit(
		        "__PORT_MESSAGE__",
		        { portId, msg, senderInstanceId: instanceId },
		        { to: remoteWindow }
		      );
		    }
		
		    function postMessage(msg) {
		      if (!_ready) {
		        buffer.push(msg);
		      } else {
		        _post(msg);
		      }
		    }
		
		    function _receive(envelope, source) {
		      // envelope: { msg, senderInstanceId }
		      if (envelope.senderInstanceId === instanceId) return; // Don't dispatch to self
		      onMessageHandlers.forEach((fn) =>
		        fn(envelope.msg, { id: portId, tab: { id: source } })
		      );
		    }
		
		    function disconnect() {
		      // Also use the 'to' parameter for disconnect messages
		      bus.emit("__PORT_DISCONNECT__", { portId }, { to: remoteWindow });
		      _disconnect();
		      delete ports[portId];
		    }
		
		    function _disconnect() {
		      onDisconnectHandlers.forEach((fn) => fn());
		      onMessageHandlers = [];
		      onDisconnectHandlers = [];
		    }
		
		    // This function is called on the client port when the ACK is received from background.
		    // It updates the port's state, completing the connection.
		    function _finalize(win) {
		      remoteWindow = win; // <-- This is the crucial part: learn the destination
		      _ready = true;
		      _drainBuffer();
		    }
		
		    return {
		      name,
		      sender: {
		        id: portId,
		      },
		      onMessage: {
		        addListener(fn) {
		          onMessageHandlers.push(fn);
		        },
		        removeListener(fn) {
		          onMessageHandlers = onMessageHandlers.filter((x) => x !== fn);
		        },
		      },
		      onDisconnect: {
		        addListener(fn) {
		          onDisconnectHandlers.push(fn);
		        },
		        removeListener(fn) {
		          onDisconnectHandlers = onDisconnectHandlers.filter((x) => x !== fn);
		        },
		      },
		      postMessage,
		      disconnect,
		      // Internal methods used by the runtime
		      _receive,
		      _disconnect,
		      _finalize, // Expose the finalizer for the ACK handler
		    };
		  }
		
		  function connect(connectInfo = {}) {
		    if (type === "background") {
		      throw new Error("Background must use onConnect, not connect()");
		    }
		    const name = connectInfo.name || "";
		    const portId = nextPortId++;
		    // create the client side port
		    // remoteWindow is initially null; it will be set by _finalize upon ACK.
		    const clientPort = makePort("client", portId, name, null);
		    ports[portId] = clientPort;
		
		    // fire the connect event across the bus
		    bus.emit("__PORT_CONNECT__", { portId, name });
		    return clientPort;
		  }
		
		  function onConnect(fn) {
		    if (type !== "background") {
		      throw new Error("connect event only fires in background");
		    }
		    onConnectListeners.push(fn);
		  }
		
		  return {
		    // rpc:
		    sendMessage,
		    onMessage: {
		      addListener(fn) {
		        msgListeners.push(fn);
		      },
		      removeListener(fn) {
		        const i = msgListeners.indexOf(fn);
		        if (i >= 0) msgListeners.splice(i, 1);
		      },
		    },
		
		    // port API:
		    connect,
		    onConnect: {
		      addListener(fn) {
		        onConnect(fn);
		      },
		      removeListener(fn) {
		        const i = onConnectListeners.indexOf(fn);
		        if (i >= 0) onConnectListeners.splice(i, 1);
		      },
		    },
		  };
		}
		
		
// #region Abstraction layer Handle postmesage for
			(function () {
			  const pendingRequests = new Map(); // requestId -> { resolve, reject, timeout }
			  let nextRequestId = 1;
			
			  window.addEventListener("message", async (event) => {
			    const { type, requestId, method, args } = event.data;
			
			    if (type === "abstraction-request") {
			      try {
			        let result;
			
			        switch (method) {
			          case "_storageSet":
			            result = await _storageSet(args[0]);
			            break;
			          case "_storageGet":
			            result = await _storageGet(args[0]);
			            break;
			          case "_storageRemove":
			            result = await _storageRemove(args[0]);
			            break;
			          case "_storageClear":
			            result = await _storageClear();
			            break;
			          case "_cookieList":
			            result = await _cookieList(args[0]);
			            break;
			          case "_cookieSet":
			            result = await _cookieSet(args[0]);
			            break;
			          case "_cookieDelete":
			            result = await _cookieDelete(args[0]);
			            break;
			          case "_fetch":
			            result = await _fetch(args[0], args[1]);
			            break;
			          case "_registerMenuCommand":
			            result = _registerMenuCommand(args[0], args[1]);
			            break;
			          case "_openTab":
			            result = _openTab(args[0], args[1]);
			            break;
			          case "_initStorage":
			            result = await _initStorage();
			            break;
			          default:
			            throw new Error(`Unknown abstraction method: ${method}`);
			        }
			
			        event.source.postMessage({
			          type: "abstraction-response",
			          requestId,
			          success: true,
			          result,
			        });
			      } catch (error) {
			        event.source.postMessage({
			          type: "abstraction-response",
			          requestId,
			          success: false,
			          error: {
			            message: error.message,
			            stack: error.stack,
			          },
			        });
			      }
			    }
			  });
			
			  _log("[PostMessage Handler] Abstraction layer message handler initialized");
			})();
			
			
// #endregion
// #region Abstraction Layer Userscript Target
			
			async function _storageSet(items) {
			  try {
			    for (const key in items) {
			      if (items.hasOwnProperty(key)) {
			        await GM_setValue(key, items[key]);
			      }
			    }
			    return Promise.resolve();
			  } catch (e) {
			    _error("GM_setValue error:", e);
			    return Promise.reject(e);
			  }
			}
			
			async function _storageGet(keys) {
			  if (!keys) {
			    keys = null;
			  }
			  if (
			    Array.isArray(keys) &&
			    (keys.length === 0 || [null, undefined].includes(keys[0]))
			  ) {
			    keys = null;
			  }
			  try {
			    const results = {};
			    let keyList = [];
			    let defaults = {};
			    let requestedKeys = [];
			
			    if (keys === null) {
			      keyList = await GM_listValues();
			      requestedKeys = [...keyList];
			    } else if (typeof keys === "string") {
			      keyList = [keys];
			      requestedKeys = [keys];
			    } else if (Array.isArray(keys)) {
			      keyList = keys;
			      requestedKeys = [...keys];
			    } else if (typeof keys === "object" && keys !== null) {
			      keyList = Object.keys(keys);
			      requestedKeys = [...keyList];
			      defaults = keys;
			    } else {
			      _error("_storageGet error: Invalid keys format", keys);
			      return Promise.reject(new Error("Invalid keys format for get"));
			    }
			
			    for (const key of keyList) {
			      const defaultValue = defaults.hasOwnProperty(key)
			        ? defaults[key]
			        : undefined;
			      const storedValue = await GM_getValue(key, defaultValue);
			      results[key] = storedValue;
			    }
			
			    const finalResult = {};
			    for (const key of requestedKeys) {
			      if (results.hasOwnProperty(key)) {
			        finalResult[key] = results[key];
			      } else if (defaults.hasOwnProperty(key)) {
			        finalResult[key] = defaults[key];
			      }
			    }
			
			    return Promise.resolve(finalResult);
			  } catch (e) {
			    _error("GM_getValue/GM_listValues error:", e);
			    return Promise.reject(e);
			  }
			}
			
			async function _storageRemove(keysToRemove) {
			  try {
			    let keyList = [];
			    if (typeof keysToRemove === "string") {
			      keyList = [keysToRemove];
			    } else if (Array.isArray(keysToRemove)) {
			      keyList = keysToRemove;
			    } else {
			      _error("_storageRemove error: Invalid keys format", keysToRemove);
			      return Promise.reject(new Error("Invalid keys format for remove"));
			    }
			
			    for (const key of keyList) {
			      await GM_deleteValue(key);
			    }
			    return Promise.resolve();
			  } catch (e) {
			    _error("GM_deleteValue error:", e);
			    return Promise.reject(e);
			  }
			}
			
			async function _storageClear() {
			  try {
			    const keys = await GM_listValues();
			    await Promise.all(keys.map((key) => GM_deleteValue(key)));
			    return Promise.resolve();
			  } catch (e) {
			    _error("GM_listValues/GM_deleteValue error during clear:", e);
			    return Promise.reject(e);
			  }
			}
			
			async function _cookieList(details) {
			  return new Promise((resolve, reject) => {
			    if (typeof GM_cookie === "undefined" || !GM_cookie.list) {
			      return reject(new Error("GM_cookie.list is not available."));
			    }
			    GM_cookie.list(details, (cookies, error) => {
			      if (error) {
			        return reject(new Error(error));
			      }
			      resolve(cookies);
			    });
			  });
			}
			
			async function _cookieSet(details) {
			  return new Promise((resolve, reject) => {
			    if (typeof GM_cookie === "undefined" || !GM_cookie.set) {
			      return reject(new Error("GM_cookie.set is not available."));
			    }
			    GM_cookie.set(details, (error) => {
			      if (error) {
			        return reject(new Error(error));
			      }
			      resolve();
			    });
			  });
			}
			
			async function _cookieDelete(details) {
			  return new Promise((resolve, reject) => {
			    if (typeof GM_cookie === "undefined" || !GM_cookie.delete) {
			      return reject(new Error("GM_cookie.delete is not available."));
			    }
			    GM_cookie.delete(details, (error) => {
			      if (error) {
			        return reject(new Error(error));
			      }
			      resolve();
			    });
			  });
			}
			
			async function _fetch(url, options = {}) {
			  return new Promise((resolve, reject) => {
			    try {
			      GM_xmlhttpRequest({
			        method: options.method || "GET",
			        url: url,
			        headers: options.headers || {},
			        data: options.body,
			        responseType: options.responseType,
			        timeout: options.timeout || 0,
			        binary:
			          options.responseType === "blob" ||
			          options.responseType === "arraybuffer",
			        onload: function (response) {
			          const responseHeaders = {};
			          if (response.responseHeaders) {
			            response.responseHeaders
			              .trim()
			              .split("\\r\\n")
			              .forEach((header) => {
			                const parts = header.match(/^([^:]+):\s*(.*)$/);
			                if (parts && parts.length === 3) {
			                  responseHeaders[parts[1].toLowerCase()] = parts[2];
			                }
			              });
			          }
			
			          const mockResponse = {
			            ok: response.status >= 200 && response.status < 300,
			            status: response.status,
			            statusText:
			              response.statusText ||
			              (response.status >= 200 && response.status < 300 ? "OK" : ""),
			            url: response.finalUrl || url,
			            headers: new Headers(responseHeaders),
			            text: () => Promise.resolve(response.responseText),
			            json: () => {
			              try {
			                return Promise.resolve(JSON.parse(response.responseText));
			              } catch (e) {
			                return Promise.reject(new SyntaxError("Could not parse JSON"));
			              }
			            },
			            blob: () => {
			              if (response.response instanceof Blob) {
			                return Promise.resolve(response.response);
			              }
			              return Promise.reject(
			                new Error("Requires responseType:'blob' in GM_xmlhttpRequest")
			              );
			            },
			            arrayBuffer: () => {
			              if (response.response instanceof ArrayBuffer) {
			                return Promise.resolve(response.response);
			              }
			              return Promise.reject(
			                new Error(
			                  "Requires responseType:'arraybuffer' in GM_xmlhttpRequest"
			                )
			              );
			            },
			            clone: function () {
			              const cloned = { ...this };
			              cloned.text = () => Promise.resolve(response.responseText);
			              cloned.json = () => this.json();
			              cloned.blob = () => this.blob();
			              cloned.arrayBuffer = () => this.arrayBuffer();
			              return cloned;
			            },
			          };
			
			          if (mockResponse.ok) {
			            resolve(mockResponse);
			          } else {
			            const error = new Error(`HTTP error! status: ${response.status}`);
			            error.response = mockResponse;
			            reject(error);
			          }
			        },
			        onerror: function (response) {
			          reject(
			            new Error(
			              `GM_xmlhttpRequest network error: ${
			                response.statusText || "Unknown Error"
			              }`
			            )
			          );
			        },
			        onabort: function () {
			          reject(new Error("GM_xmlhttpRequest aborted"));
			        },
			        ontimeout: function () {
			          reject(new Error("GM_xmlhttpRequest timed out"));
			        },
			      });
			    } catch (e) {
			      _error("_fetch (GM_xmlhttpRequest) error:", e);
			      reject(e);
			    }
			  });
			}
			
			function _registerMenuCommand(name, func) {
			  if (typeof GM_registerMenuCommand === "function") {
			    try {
			      GM_registerMenuCommand(name, func);
			    } catch (e) {
			      _error("GM_registerMenuCommand failed:", e);
			    }
			  } else {
			    _warn("GM_registerMenuCommand not available.");
			  }
			}
			
			function _openTab(url, active) {
			  if (typeof GM_openInTab === "function") {
			    try {
			      GM_openInTab(url, { loadInBackground: !active });
			    } catch (e) {
			      _error("GM_openInTab failed:", e);
			    }
			  } else {
			    _warn("GM_openInTab not available, using window.open as fallback.");
			    try {
			      window.open(url);
			    } catch (e) {
			      _error("window.open fallback failed:", e);
			    }
			  }
			}
			
			async function _initStorage() {
			  return Promise.resolve();
			}
			
			
			const EXTENSION_ASSETS_MAP = {
			  "popup/popup.html": "<!DOCTYPE html>\r\n<html lang=\"en\">\r\n<head>\r\n  <meta charset=\"UTF-8\">\r\n  <title>e621 extras</title>\r\n  <style>\n* {\r\n  box-sizing: border-box;\r\n  margin: 0;\r\n  padding: 0;\r\n  font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif;\r\n  -webkit-font-smoothing: antialiased;\r\n}\r\n\r\nbody {\r\n  width: 290px;\r\n  background-color: #000000;\r\n  color: #ffffff;\r\n  padding: 14px;\r\n  user-select: none;\r\n}\r\n\r\n/* 1. Remove arrows from numeric input */\r\ninput::-webkit-outer-spin-button,\r\ninput::-webkit-inner-spin-button {\r\n  -webkit-appearance: none;\r\n  margin: 0;\r\n}\r\n\r\ninput[type=\"number\"] {\r\n  -moz-appearance: textfield;\r\n  appearance: textfield;\r\n}\r\n\r\n.container {\r\n  display: flex;\r\n  flex-direction: column;\r\n  gap: 12px;\r\n}\r\n\r\n.header {\r\n  display: flex;\r\n  align-items: center;\r\n  padding-bottom: 2px;\r\n}\r\n\r\n.title {\r\n  font-size: 13px;\r\n  font-weight: 600;\r\n  letter-spacing: 0.8px;\r\n  text-transform: uppercase;\r\n}\r\n\r\n/* Tabs */\r\n.tabs {\r\n  display: flex;\r\n  gap: 4px;\r\n  border-bottom: 1px solid #222222;\r\n  padding-bottom: 8px;\r\n}\r\n\r\n.tab-btn {\r\n  flex: 1;\r\n  background: #000000;\r\n  color: #666666;\r\n  border: 1px solid #222222;\r\n  padding: 6px 0;\r\n  font-size: 10px;\r\n  font-weight: 600;\r\n  letter-spacing: 0.5px;\r\n  cursor: pointer;\r\n  transition: all 0.15s ease;\r\n  text-align: center;\r\n}\r\n\r\n.tab-btn:hover {\r\n  color: #cccccc;\r\n  background-color: #0a0a0a;\r\n}\r\n\r\n.tab-btn.active {\r\n  background-color: #ffffff;\r\n  color: #000000;\r\n  border-color: #ffffff;\r\n}\r\n\r\n.tab-content {\r\n  display: flex;\r\n  flex-direction: column;\r\n  gap: 10px;\r\n}\r\n\r\n.section {\r\n  display: flex;\r\n  flex-direction: column;\r\n  gap: 8px;\r\n}\r\n\r\n.hidden {\r\n  display: none !important;\r\n}\r\n\r\n.btn {\r\n  width: 100%;\r\n  background: #000000;\r\n  color: #ffffff;\r\n  border: 1px solid #272727;\r\n  padding: 8px 12px;\r\n  font-size: 12px;\r\n  letter-spacing: 0.3px;\r\n  cursor: pointer;\r\n  display: flex;\r\n  justify-content: space-between;\r\n  align-items: center;\r\n  transition: background-color 0.15s ease, border-color 0.15s ease;\r\n}\r\n\r\n.btn:hover:not(:disabled) {\r\n  background-color: #141414;\r\n  border-color: #444444;\r\n}\r\n\r\n.btn:active:not(:disabled) {\r\n  background-color: #222222;\r\n}\r\n\r\n.btn:disabled {\r\n  color: #444444;\r\n  border-color: #181818;\r\n  cursor: not-allowed;\r\n}\r\n\r\n.btn-sub {\r\n  padding-left: 20px;\r\n  color: #aaaaaa;\r\n}\r\n\r\n.setting-row {\r\n  display: flex;\r\n  justify-content: space-between;\r\n  align-items: center;\r\n  background: #0a0a0a;\r\n  border: 1px solid #222222;\r\n  padding: 10px 12px;\r\n}\r\n\r\n.setting-block {\r\n  display: flex;\r\n  flex-direction: column;\r\n  gap: 8px;\r\n  background: #0a0a0a;\r\n  border: 1px solid #222222;\r\n  padding: 10px 12px;\r\n}\r\n\r\n.setting-info {\r\n  display: flex;\r\n  flex-direction: column;\r\n  gap: 2px;\r\n}\r\n\r\n.setting-label {\r\n  font-size: 12px;\r\n  color: #ffffff;\r\n}\r\n\r\n.setting-desc {\r\n  font-size: 10px;\r\n  color: #666666;\r\n}\r\n\r\n.btn-toggle-switch {\r\n  background: transparent;\r\n  border: none;\r\n  cursor: pointer;\r\n  padding: 0;\r\n}\r\n\r\n.input-inline-group {\r\n  display: flex;\r\n  gap: 6px;\r\n  align-items: center;\r\n}\r\n\r\n.input-minimal {\r\n  flex: 1;\r\n  background: #000000;\r\n  border: 1px solid #272727;\r\n  color: #ffffff;\r\n  padding: 6px 10px;\r\n  font-size: 12px;\r\n  outline: none;\r\n  transition: border-color 0.15s;\r\n}\r\n\r\n.input-minimal:focus {\r\n  border-color: #666666;\r\n}\r\n\r\n.btn-inline {\r\n  width: auto;\r\n  padding: 6px 14px;\r\n}\r\n\r\n.badge {\r\n  display: inline-block;\r\n  width: 36px;\r\n  text-align: center;\r\n  font-size: 10px;\r\n  border: 1px solid #444444;\r\n  padding: 2px 0;\r\n  text-transform: uppercase;\r\n  color: #ffffff;\r\n  background-color: transparent;\r\n  font-weight: 500;\r\n}\r\n\r\n.badge.on {\r\n  background-color: #ffffff;\r\n  color: #000000;\r\n  border-color: #ffffff;\r\n}\r\n\r\n.footer {\r\n  border-top: 1px solid #222222;\r\n  padding-top: 8px;\r\n}\r\n\r\n.status-msg {\r\n  font-size: 11px;\r\n  color: #888888;\r\n  line-height: 1.4;\r\n  min-height: 16px;\r\n  word-break: break-word;\r\n}\r\n\r\n/* 2. Screen styles for third-party pages */\r\n.offline-view {\r\n  display: flex;\r\n  flex-direction: column;\r\n  align-items: center;\r\n  justify-content: center;\r\n  min-height: 160px;\r\n  text-align: center;\r\n  gap: 14px;\r\n  padding: 8px 0;\r\n}\r\n\r\n.offline-text {\r\n  font-size: 12px;\r\n  color: #888888;\r\n  line-height: 1.4;\r\n}\r\n\r\n.offline-links {\r\n  display: flex;\r\n  flex-direction: column;\r\n  gap: 8px;\r\n  width: 100%;\r\n}\r\n\r\n.offline-link {\r\n  display: block;\r\n  text-decoration: none;\r\n  color: #ffffff;\r\n  background-color: #0a0a0a;\r\n  border: 1px solid #222222;\r\n  padding: 8px 0;\r\n  font-size: 12px;\r\n  letter-spacing: 0.5px;\r\n  transition: background-color 0.15s, border-color 0.15s;\r\n}\r\n\r\n.offline-link:hover {\r\n  background-color: #141414;\r\n  border-color: #444444;\r\n}\n</style>\r\n</head>\r\n<body>\r\n  <!-- Shown on non-e621 pages -->\r\n  <div id=\"offlineView\" class=\"offline-view hidden\">\r\n    <p class=\"offline-text\">extension works on these webpages:</p>\r\n    <div class=\"offline-links\">\r\n      <a href=\"https://e621.net\" target=\"_blank\" class=\"offline-link\">e621.net</a>\r\n      <a href=\"https://e926.net\" target=\"_blank\" class=\"offline-link\">e926.net</a>\r\n    </div>\r\n  </div>\r\n\r\n  <!-- Main UI -->\r\n  <div id=\"mainView\" class=\"container\">\r\n    <header class=\"header\">\r\n      <h1 class=\"title\">e621 extras</h1>\r\n    </header>\r\n\r\n    <nav class=\"tabs\">\r\n      <button class=\"tab-btn active\" data-tab=\"main\">MAIN</button>\r\n      <button class=\"tab-btn\" data-tab=\"blck\">BLCK</button>\r\n      <button class=\"tab-btn\" data-tab=\"tagscr\">TAGSCR</button>\r\n      <button class=\"tab-btn\" data-tab=\"hz\">HZ</button>\r\n    </nav>\r\n\r\n    <!-- Tab 1: MAIN -->\r\n    <main id=\"tab-main\" class=\"tab-content\">\r\n      <div class=\"setting-row\">\r\n        <div class=\"setting-info\">\r\n          <span class=\"setting-label\">Hide Thumbnail Tooltips</span>\r\n          <span class=\"setting-desc\">Suppress browser tooltip on thumbnails</span>\r\n        </div>\r\n        <button id=\"btnHideTooltipsToggle\" class=\"btn-toggle-switch\">\r\n          <span id=\"hideTooltipsBadge\" class=\"badge\">OFF</span>\r\n        </button>\r\n      </div>\r\n\r\n      <div class=\"setting-row\">\r\n        <div class=\"setting-info\">\r\n          <span class=\"setting-label\">Tracking FPS</span>\r\n          <span class=\"setting-desc\">0 = Monitor Hz (or limit for weak PCs)</span>\r\n        </div>\r\n        <input type=\"number\" id=\"inputTrackingFps\" class=\"input-minimal\" placeholder=\"0\" min=\"0\" max=\"360\" style=\"width: 58px; flex: none; text-align: center;\" />\r\n      </div>\r\n\r\n      <div class=\"setting-row\">\r\n        <div class=\"setting-info\">\r\n          <span class=\"setting-label\">Show Uploader</span>\r\n          <span class=\"setting-desc\">Under status in post details</span>\r\n        </div>\r\n        <button id=\"btnShowUploader\" class=\"btn-toggle-switch\">\r\n          <span id=\"showUploaderBadge\" class=\"badge on\">ON</span>\r\n        </button>\r\n      </div>\r\n\r\n      <div class=\"setting-block\">\r\n        <span class=\"setting-label\">Show Post Tree</span>\r\n        <div class=\"input-inline-group\">\r\n          <input type=\"number\" id=\"inputTreePostId\" class=\"input-minimal\" placeholder=\"post id\" />\r\n          <button id=\"btnShowTreePopup\" class=\"btn btn-inline\">Show</button>\r\n        </div>\r\n      </div>\r\n    </main>\r\n\r\n    <!-- Tab 2: BLCK -->\r\n    <main id=\"tab-blck\" class=\"tab-content hidden\">\r\n      <div class=\"section\">\r\n        <button id=\"btnAutoUpdate\" class=\"btn\" title=\"Keep the blacklist in sync with your downvotes automatically\">\r\n          <span>Auto Update</span>\r\n          <span id=\"autoUpdateState\" class=\"badge\">OFF</span>\r\n        </button>\r\n        <button id=\"btnSyncApi\" class=\"btn btn-sub hidden\" title=\"Re-fetch downvotes and update the blacklist\">↳ Sync via API</button>\r\n      </div>\r\n\r\n      <div id=\"manualActions\" class=\"section\">\r\n        <button id=\"btnBackup\" class=\"btn\" title=\"Save the current blacklist in the extension\">Backup Current Blacklist</button>\r\n        <button id=\"btnLoadDownvotes\" class=\"btn\" title=\"Fetch your downvoted posts from the site into the extension\">Load Downvotes</button>\r\n        <button id=\"btnUpload\" class=\"btn\" title=\"Add the loaded downvotes to your blacklist as id:N rules\">Upload to Blacklist</button>\r\n        <button id=\"btnUnload\" class=\"btn\" title=\"Remove those id:N rules from your blacklist\">Unload from Blacklist</button>\r\n      </div>\r\n    </main>\r\n\r\n    <!-- Tab 3: TAGSCR -->\r\n    <main id=\"tab-tagscr\" class=\"tab-content hidden\">\r\n      <div class=\"setting-row\">\r\n        <div class=\"setting-info\">\r\n          <span class=\"setting-label\">Tag Script Preview (Ctrl)</span>\r\n          <span class=\"setting-desc\">View active tag scripts</span>\r\n        </div>\r\n        <button id=\"btnCtrlPreviewToggle\" class=\"btn-toggle-switch\">\r\n          <span id=\"ctrlPreviewBadge\" class=\"badge on\">ON</span>\r\n        </button>\r\n      </div>\r\n\r\n      <div class=\"setting-row\">\r\n        <div class=\"setting-info\">\r\n          <span class=\"setting-label\">Sticky Preview (Ctrl)</span>\r\n          <span class=\"setting-desc\">Toggle with Ctrl instead of holding</span>\r\n        </div>\r\n        <button id=\"btnCtrlStickyToggle\" class=\"btn-toggle-switch\">\r\n          <span id=\"ctrlStickyBadge\" class=\"badge\">OFF</span>\r\n        </button>\r\n      </div>\r\n\r\n      <div class=\"setting-row\">\r\n        <div class=\"setting-info\">\r\n          <span class=\"setting-label\">Queued Tag Scripts</span>\r\n          <span class=\"setting-desc\">Queue edits during hourly limits</span>\r\n        </div>\r\n        <button id=\"btnQueueToggle\" class=\"btn-toggle-switch\">\r\n          <span id=\"queueBadge\" class=\"badge\">OFF</span>\r\n        </button>\r\n      </div>\r\n\r\n      <div id=\"queueBlock\" class=\"setting-block hidden\">\r\n        <div class=\"setting-info\">\r\n          <span class=\"setting-label\">Tag Script Queue</span>\r\n          <span id=\"queueStatusText\" class=\"setting-desc\">0 posts queued</span>\r\n        </div>\r\n        <div class=\"input-inline-group\">\r\n          <a id=\"btnOpenTimeouted\" href=\"https://e621.net/posts/timeouted\" target=\"_blank\" class=\"btn btn-inline\">View Queue</a>\r\n          <button id=\"btnProcessQueue\" class=\"btn btn-inline\">Process Now</button>\r\n        </div>\r\n      </div>\r\n    </main>\r\n\r\n    <!-- Tab 4: HZ -->\r\n    <main id=\"tab-hz\" class=\"tab-content hidden\">\r\n      <div class=\"setting-row\">\r\n        <div class=\"setting-info\">\r\n          <span class=\"setting-label\">Hover Zoom (Shift)</span>\r\n          <span class=\"setting-desc\">Hold Shift while hovering</span>\r\n        </div>\r\n        <button id=\"btnHzToggle\" class=\"btn-toggle-switch\">\r\n          <span id=\"hzBadge\" class=\"badge on\">ON</span>\r\n        </button>\r\n      </div>\r\n\r\n      <div class=\"setting-row\">\r\n        <div class=\"setting-info\">\r\n          <span class=\"setting-label\">Load Sample on Hover</span>\r\n          <span class=\"setting-desc\">Load sample image instead of full</span>\r\n        </div>\r\n        <button id=\"btnHzSampleToggle\" class=\"btn-toggle-switch\">\r\n          <span id=\"hzSampleBadge\" class=\"badge on\">ON</span>\r\n        </button>\r\n      </div>\r\n    </main>\r\n\r\n    <footer class=\"footer\">\r\n      <div id=\"statusMessage\" class=\"status-msg\">Ready</div>\r\n    </footer>\r\n  </div>\r\n\r\n  <script>\n/* Shared by content scripts, popup and background — single source of truth for keys and message names. */\r\nglobalThis.E621_CONSTANTS = Object.freeze({\r\n  SCHEMA_VERSION: 1,\r\n\r\n  STORAGE_KEYS: Object.freeze({\r\n    SCHEMA_VERSION: 'e621_schema_version',\r\n    DOWNVOTES: 'e621_downvoted_posts',\r\n    BLACKLIST_BACKUP: 'e621_clean_blacklist_backup',\r\n    BLACKLIST_LOCKED: 'e621_load_blacklist_disabled',\r\n    AUTO_UPDATE: 'e621_auto_update_enabled',\r\n    SHOW_UPLOADER: 'e621_extra_show_uploader',\r\n    ACTIVE_POPUP_TAB: 'e621_active_popup_tab',\r\n\r\n    /* Hover Zoom keys */\r\n    HZ_ENABLED: 'e621_hz_enabled',\r\n    HZ_LOAD_SAMPLE: 'e621_hz_load_sample',\r\n    HZ_TAGS: 'e621_hz_tags',\r\n    HZ_TIME: 'e621_hz_time',\r\n    HZ_AUDIO: 'e621_hz_audio',\r\n    HZ_DELAY: 'e621_hz_delay',\r\n    HZ_STICKY: 'e621_hz_sticky',\r\n\r\n    /* Queued / Timeouted Tag Scripts keys */\r\n    QUEUE_TAG_SCRIPTS_ENABLED: 'e621_queue_tag_scripts_enabled',\r\n    TAG_SCRIPT_QUEUE: 'e621_tag_script_queue',\r\n    QUEUE_TIMEOUT_UNTIL: 'e621_queue_timeout_until',\r\n    QUEUE_SLOT_TIMESTAMPS: 'e621_queue_slot_timestamps',\r\n\r\n    /* Preview & Tooltip suppression & Performance */\r\n    CTRL_PREVIEW_ENABLED: 'e621_ctrl_preview_enabled',\r\n    CTRL_PREVIEW_STICKY: 'e621_ctrl_preview_sticky',\r\n    CTRL_STICKY_ACTIVE: 'e621_ctrl_sticky_active',\r\n    HIDE_THUMB_TOOLTIPS: 'e621_hide_thumb_tooltips',\r\n    TRACKING_FPS: 'e621_tracking_fps'\r\n  }),\r\n\r\n  ACTIONS: Object.freeze({\r\n    BACKUP_BLACKLIST: 'backupBlacklist',\r\n    LOAD_DOWNVOTES: 'loadDownvotes',\r\n    UPLOAD_DOWNVOTES: 'uploadDownvotes',\r\n    UNLOAD_DOWNVOTES: 'unloadDownvotes',\r\n    SYNC_API: 'syncApi',\r\n    TOGGLE_AUTO_UPDATE: 'toggleAutoUpdate',\r\n    SHOW_POST_TREE: 'showPostTree',\r\n    FETCH_IMAGE: 'fetchImageAsDataUrl',\r\n    PROCESS_TAG_QUEUE: 'processTagQueue',\r\n    CLEAR_TAG_QUEUE: 'clearTagQueue',\r\n    ENQUEUE_TAG_SCRIPT: 'enqueueTagScript',\r\n    DEQUEUE_TAG_SCRIPT: 'dequeueTagScript',\r\n    SAVE_IMAGE: 'saveImage',\r\n    GET_IMAGE: 'getImage',\r\n    DELETE_IMAGE: 'deleteImage',\r\n    CLEAR_IMAGES: 'clearImages',\r\n    SET_CSRF_TOKEN: 'setCsrfToken',\r\n    TAG_SCRIPT_POST_STATUS: 'tagScriptPostStatus'\r\n  })\r\n});\n</script>\r\n  <script>\ndocument.addEventListener('DOMContentLoaded', async () => {\r\n  const { STORAGE_KEYS: KEYS, ACTIONS } = E621_CONSTANTS;\r\n  const $ = (id) => document.getElementById(id);\r\n\r\n  const mainView = $('mainView');\r\n  const offlineView = $('offlineView');\r\n  const statusMsg = $('statusMessage');\r\n  const tabBtns = document.querySelectorAll('.tab-btn');\r\n  const tabs = {\r\n    main: $('tab-main'),\r\n    blck: $('tab-blck'),\r\n    tagscr: $('tab-tagscr'),\r\n    hz: $('tab-hz')\r\n  };\r\n\r\n  const autoUpdateState = $('autoUpdateState');\r\n  const btnSyncApi = $('btnSyncApi');\r\n  const manualActions = $('manualActions');\r\n  const btnBackup = $('btnBackup');\r\n  const showUploaderBadge = $('showUploaderBadge');\r\n  const inputTreePostId = $('inputTreePostId');\r\n\r\n  const setStatus = (text) => { statusMsg.textContent = text; };\r\n  const setButtonsDisabled = (disabled) =>\r\n    document.querySelectorAll('.btn').forEach(b => { b.disabled = disabled; });\r\n\r\n  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });\r\n  const isE621 = tab?.url && /^https:\\/\\/(e621|e926)\\.net\\//.test(tab.url);\r\n\r\n  if (!isE621) {\r\n    mainView.classList.add('hidden');\r\n    offlineView.classList.remove('hidden');\r\n    return;\r\n  }\r\n\r\n  function showTab(name) {\r\n    tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === name));\r\n    Object.entries(tabs).forEach(([key, node]) => node.classList.toggle('hidden', key !== name));\r\n  }\r\n\r\n  tabBtns.forEach(btn => btn.addEventListener('click', () => {\r\n    showTab(btn.dataset.tab);\r\n    chrome.storage.local.set({ [KEYS.ACTIVE_POPUP_TAB]: btn.dataset.tab });\r\n  }));\r\n\r\n  const postMatch = tab.url.match(/\\/posts\\/(\\d+)/);\r\n  if (postMatch) inputTreePostId.value = postMatch[1];\r\n\r\n  const btnHzToggle = $('btnHzToggle');\r\n  const hzBadge = $('hzBadge');\r\n  const btnHzSampleToggle = $('btnHzSampleToggle');\r\n  const hzSampleBadge = $('hzSampleBadge');\r\n\r\n  const btnCtrlPreviewToggle = $('btnCtrlPreviewToggle');\r\n  const ctrlPreviewBadge = $('ctrlPreviewBadge');\r\n  const btnCtrlStickyToggle = $('btnCtrlStickyToggle');\r\n  const ctrlStickyBadge = $('ctrlStickyBadge');\r\n  const inputTrackingFps = $('inputTrackingFps');\r\n  const btnHideTooltipsToggle = $('btnHideTooltipsToggle');\r\n  const hideTooltipsBadge = $('hideTooltipsBadge');\r\n\r\n  const btnQueueToggle = $('btnQueueToggle');\r\n  const queueBadge = $('queueBadge');\r\n  const queueBlock = $('queueBlock');\r\n  const queueStatusText = $('queueStatusText');\r\n  const btnProcessQueue = $('btnProcessQueue');\r\n  const btnOpenTimeouted = $('btnOpenTimeouted');\r\n\r\n  if (btnOpenTimeouted && tab.url) {\r\n    const isE926 = /^https:\\/\\/e926\\.net/i.test(tab.url);\r\n    btnOpenTimeouted.href = isE926 ? 'https://e926.net/posts/timeouted' : 'https://e621.net/posts/timeouted';\r\n  }\r\n\r\n  function formatTime(ms) {\r\n    const totalSec = Math.ceil(ms / 1000);\r\n    const mins = Math.floor(totalSec / 60);\r\n    const secs = totalSec % 60;\r\n    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;\r\n  }\r\n\r\n  async function refreshUI() {\r\n    const data = await chrome.storage.local.get([\r\n      KEYS.AUTO_UPDATE,\r\n      KEYS.BLACKLIST_LOCKED,\r\n      KEYS.SHOW_UPLOADER,\r\n      KEYS.HZ_ENABLED,\r\n      KEYS.HZ_LOAD_SAMPLE,\r\n      KEYS.CTRL_PREVIEW_ENABLED,\r\n      KEYS.CTRL_PREVIEW_STICKY,\r\n      KEYS.TRACKING_FPS,\r\n      KEYS.HIDE_THUMB_TOOLTIPS,\r\n      KEYS.QUEUE_TAG_SCRIPTS_ENABLED,\r\n      KEYS.TAG_SCRIPT_QUEUE,\r\n      KEYS.QUEUE_TIMEOUT_UNTIL,\r\n      KEYS.QUEUE_SLOT_TIMESTAMPS\r\n    ]);\r\n\r\n    const isAuto = Boolean(data[KEYS.AUTO_UPDATE]);\r\n    const isLocked = Boolean(data[KEYS.BLACKLIST_LOCKED]);\r\n\r\n    const hzEnabled = data[KEYS.HZ_ENABLED] !== false;\r\n    hzBadge.textContent = hzEnabled ? 'ON' : 'OFF';\r\n    hzBadge.classList.toggle('on', hzEnabled);\r\n\r\n    const hzSample = data[KEYS.HZ_LOAD_SAMPLE] !== false;\r\n    hzSampleBadge.textContent = hzSample ? 'ON' : 'OFF';\r\n    hzSampleBadge.classList.toggle('on', hzSample);\r\n\r\n    const ctrlPreview = data[KEYS.CTRL_PREVIEW_ENABLED] !== false;\r\n    ctrlPreviewBadge.textContent = ctrlPreview ? 'ON' : 'OFF';\r\n    ctrlPreviewBadge.classList.toggle('on', ctrlPreview);\r\n\r\n    const ctrlSticky = Boolean(data[KEYS.CTRL_PREVIEW_STICKY]);\r\n    ctrlStickyBadge.textContent = ctrlSticky ? 'ON' : 'OFF';\r\n    ctrlStickyBadge.classList.toggle('on', ctrlSticky);\r\n\r\n    if (inputTrackingFps && document.activeElement !== inputTrackingFps) {\r\n      inputTrackingFps.value = Number(data[KEYS.TRACKING_FPS]) || 0;\r\n    }\r\n\r\n    const hideTooltips = Boolean(data[KEYS.HIDE_THUMB_TOOLTIPS]);\r\n    hideTooltipsBadge.textContent = hideTooltips ? 'ON' : 'OFF';\r\n    hideTooltipsBadge.classList.toggle('on', hideTooltips);\r\n\r\n    const queueEnabled = Boolean(data[KEYS.QUEUE_TAG_SCRIPTS_ENABLED]);\r\n    queueBadge.textContent = queueEnabled ? 'ON' : 'OFF';\r\n    queueBadge.classList.toggle('on', queueEnabled);\r\n    queueBlock.classList.toggle('hidden', !queueEnabled);\r\n\r\n    const queue = data[KEYS.TAG_SCRIPT_QUEUE] || {};\r\n    const count = Object.keys(queue).length;\r\n    const slots = data[KEYS.QUEUE_SLOT_TIMESTAMPS] || [];\r\n    const timeoutUntil = Number(data[KEYS.QUEUE_TIMEOUT_UNTIL]) || 0;\r\n    const now = Date.now();\r\n\r\n    const nextSlot = slots[0] || timeoutUntil;\r\n    const isTimeout = nextSlot > now;\r\n\r\n    if (isTimeout && count > 0) {\r\n      const nextMs = Math.max(0, nextSlot - now);\r\n      const allSlotIdx = Math.min(count - 1, slots.length - 1);\r\n      const allSlot = slots[allSlotIdx] || nextSlot;\r\n      const allMs = Math.max(0, allSlot - now);\r\n\r\n      if (count > 1) {\r\n        queueStatusText.textContent = `${count} queued (next: ${formatTime(nextMs)}, all: ${formatTime(allMs)})`;\r\n      } else {\r\n        queueStatusText.textContent = `1 queued (ready in ${formatTime(nextMs)})`;\r\n      }\r\n    } else {\r\n      queueStatusText.textContent = `${count} posts queued (ready)`;\r\n    }\r\n\r\n    setButtonsDisabled(false);\r\n    autoUpdateState.textContent = isAuto ? 'ON' : 'OFF';\r\n    autoUpdateState.classList.toggle('on', isAuto);\r\n    btnSyncApi.classList.toggle('hidden', !isAuto);\r\n    manualActions.classList.toggle('hidden', isAuto);\r\n    if (!isAuto) btnBackup.disabled = isLocked;\r\n\r\n    const showUploader = data[KEYS.SHOW_UPLOADER] !== false;\r\n    showUploaderBadge.textContent = showUploader ? 'ON' : 'OFF';\r\n    showUploaderBadge.classList.toggle('on', showUploader);\r\n  }\r\n\r\n  btnHzToggle?.addEventListener('click', async () => {\r\n    const data = await chrome.storage.local.get([KEYS.HZ_ENABLED]);\r\n    await chrome.storage.local.set({ [KEYS.HZ_ENABLED]: data[KEYS.HZ_ENABLED] === false });\r\n    await refreshUI();\r\n  });\r\n\r\n  btnHzSampleToggle?.addEventListener('click', async () => {\r\n    const data = await chrome.storage.local.get([KEYS.HZ_LOAD_SAMPLE]);\r\n    const current = data[KEYS.HZ_LOAD_SAMPLE] !== false;\r\n    await chrome.storage.local.set({ [KEYS.HZ_LOAD_SAMPLE]: !current });\r\n    await refreshUI();\r\n  });\r\n\r\n  btnCtrlPreviewToggle?.addEventListener('click', async () => {\r\n    const data = await chrome.storage.local.get([KEYS.CTRL_PREVIEW_ENABLED]);\r\n    const current = data[KEYS.CTRL_PREVIEW_ENABLED] !== false;\r\n    await chrome.storage.local.set({ [KEYS.CTRL_PREVIEW_ENABLED]: !current });\r\n    if (current) {\r\n      await chrome.storage.local.set({ [KEYS.CTRL_STICKY_ACTIVE]: false });\r\n    }\r\n    await refreshUI();\r\n  });\r\n\r\n  btnCtrlStickyToggle?.addEventListener('click', async () => {\r\n    const data = await chrome.storage.local.get([KEYS.CTRL_PREVIEW_STICKY]);\r\n    const current = Boolean(data[KEYS.CTRL_PREVIEW_STICKY]);\r\n    await chrome.storage.local.set({ [KEYS.CTRL_PREVIEW_STICKY]: !current });\r\n    if (current) {\r\n      await chrome.storage.local.set({ [KEYS.CTRL_STICKY_ACTIVE]: false });\r\n    }\r\n    await refreshUI();\r\n  });\r\n\r\n  inputTrackingFps?.addEventListener('change', async () => {\r\n    let val = parseInt(inputTrackingFps.value, 10);\r\n    if (isNaN(val) || val < 0) val = 0;\r\n    if (val > 360) val = 360;\r\n    inputTrackingFps.value = val;\r\n    await chrome.storage.local.set({ [KEYS.TRACKING_FPS]: val });\r\n  });\r\n\r\n  inputTrackingFps?.addEventListener('keydown', (e) => {\r\n    if (e.key === 'Enter') inputTrackingFps.blur();\r\n  });\r\n\r\n  btnHideTooltipsToggle?.addEventListener('click', async () => {\r\n    const data = await chrome.storage.local.get([KEYS.HIDE_THUMB_TOOLTIPS]);\r\n    const current = Boolean(data[KEYS.HIDE_THUMB_TOOLTIPS]);\r\n    await chrome.storage.local.set({ [KEYS.HIDE_THUMB_TOOLTIPS]: !current });\r\n    await refreshUI();\r\n  });\r\n\r\n  btnQueueToggle?.addEventListener('click', async () => {\r\n    const data = await chrome.storage.local.get([KEYS.QUEUE_TAG_SCRIPTS_ENABLED]);\r\n    await chrome.storage.local.set({ [KEYS.QUEUE_TAG_SCRIPTS_ENABLED]: !data[KEYS.QUEUE_TAG_SCRIPTS_ENABLED] });\r\n    await refreshUI();\r\n  });\r\n\r\n  async function sendAction(action) {\r\n    const enabling = action === ACTIONS.TOGGLE_AUTO_UPDATE && autoUpdateState.textContent === 'OFF';\r\n    setStatus(enabling ? 'Syncing API & enabling...' : 'Processing...');\r\n    setButtonsDisabled(true);\r\n\r\n    try {\r\n      let response = null;\r\n\r\n      try {\r\n        response = await chrome.tabs.sendMessage(tab.id, { action });\r\n      } catch (err) {}\r\n\r\n      if (!response && window.parent && window.parent !== window) {\r\n        response = await new Promise((resolve) => {\r\n          const channel = new MessageChannel();\r\n          channel.port1.onmessage = (e) => resolve(e.data);\r\n          window.parent.postMessage({ fromE621Popup: true, action }, '*', [channel.port2]);\r\n          setTimeout(() => resolve(null), 5000);\r\n        });\r\n      }\r\n\r\n      setStatus(response?.status || (response?.ok === false ? 'Failed' : 'Done'));\r\n    } catch (err) {\r\n      const noReceiver = /Receiving end does not exist|message (channel|port) closed/i.test(err.message);\r\n      setStatus(noReceiver ? 'Error: Refresh the page' : `Error: ${err.message}`);\r\n    } finally {\r\n      await refreshUI();\r\n    }\r\n  }\r\n\r\n  $('btnAutoUpdate').addEventListener('click', () => sendAction(ACTIONS.TOGGLE_AUTO_UPDATE));\r\n  btnSyncApi.addEventListener('click', () => sendAction(ACTIONS.SYNC_API));\r\n  btnBackup.addEventListener('click', () => sendAction(ACTIONS.BACKUP_BLACKLIST));\r\n  $('btnLoadDownvotes').addEventListener('click', () => sendAction(ACTIONS.LOAD_DOWNVOTES));\r\n  $('btnUpload').addEventListener('click', () => sendAction(ACTIONS.UPLOAD_DOWNVOTES));\r\n  $('btnUnload').addEventListener('click', () => sendAction(ACTIONS.UNLOAD_DOWNVOTES));\r\n  btnProcessQueue?.addEventListener('click', () => sendAction(ACTIONS.PROCESS_TAG_QUEUE));\r\n\r\n  $('btnShowUploader').addEventListener('click', async () => {\r\n    const data = await chrome.storage.local.get([KEYS.SHOW_UPLOADER]);\r\n    await chrome.storage.local.set({ [KEYS.SHOW_UPLOADER]: data[KEYS.SHOW_UPLOADER] === false });\r\n    await refreshUI();\r\n  });\r\n\r\n  $('btnShowTreePopup').addEventListener('click', async () => {\r\n    const id = Number(inputTreePostId.value.trim());\r\n    if (!Number.isInteger(id) || id <= 0) return setStatus('Enter a valid post ID');\r\n    try {\r\n      await chrome.tabs.sendMessage(tab.id, { action: ACTIONS.SHOW_POST_TREE, postId: id });\r\n      window.close();\r\n    } catch (err) {\r\n      setStatus('Error: Refresh the page');\r\n    }\r\n  });\r\n\r\n  const stored = await chrome.storage.local.get([KEYS.ACTIVE_POPUP_TAB]);\r\n  const validTabs = ['main', 'blck', 'tagscr', 'hz'];\r\n  let initialTab = 'main';\r\n  if (stored[KEYS.ACTIVE_POPUP_TAB] === 'extra') {\r\n    initialTab = 'tagscr';\r\n  } else if (validTabs.includes(stored[KEYS.ACTIVE_POPUP_TAB])) {\r\n    initialTab = stored[KEYS.ACTIVE_POPUP_TAB];\r\n  }\r\n  showTab(initialTab);\r\n\r\n  await refreshUI();\r\n\r\n  const liveTimer = setInterval(refreshUI, 1000);\r\n  window.addEventListener('unload', () => clearInterval(liveTimer));\r\n});\n</script>\r\n</body>\r\n</html>"
			};
			
// #endregion
// #endregion
// #region Polyfill Implementation
		function buildPolyfill({ isBackground = false, isOtherPage = false } = {}) {
		  // Generate a unique context ID for this polyfill instance
		  const contextType = isBackground
		    ? "background"
		    : isOtherPage
		      ? "options"
		      : "content";
		  const contextId = `${contextType}_${Math.random()
		    .toString(36)
		    .substring(2, 15)}`;
		
		  const IS_IFRAME = "false" === "true";
		  const BUS = (function () {
		    if (globalThis.__BUS) {
		      return globalThis.__BUS;
		    }
		    globalThis.__BUS = createEventBus(
		      "e621-extras",
		      IS_IFRAME ? "iframe" : "page",
		    );
		    return globalThis.__BUS;
		  })();
		  const RUNTIME = createRuntime(isBackground ? "background" : "tab", BUS);
		  const createNoopListeners = () => ({
		    addListener: (callback) => {
		      _log("addListener", callback);
		    },
		    removeListener: (callback) => {
		      _log("removeListener", callback);
		    },
		  });
		  // TODO: Stub
		  const storageChangeListeners = new Set();
		  function broadcastStorageChange(changes, areaName) {
		    storageChangeListeners.forEach((listener) => {
		      listener(changes, areaName);
		    });
		  }
		
		  let REQ_PERMS = [];
		
  // #region Chrome polyfill
			  let chrome = {
			    extension: {
			      isAllowedIncognitoAccess: () => Promise.resolve(true),
			      sendMessage: (...args) => _messagingHandler.sendMessage(...args),
			    },
			    permissions: {
			      // TODO: Remove origin permission means exclude from origin in startup (when checking for content scripts)
			      request: (permissions, callback) => {
			        _log("permissions.request", permissions, callback);
			        if (Array.isArray(permissions)) {
			          REQ_PERMS = [...REQ_PERMS, ...permissions];
			        }
			        if (typeof callback === "function") {
			          callback(permissions);
			        }
			        return Promise.resolve(permissions);
			      },
			      contains: (permissions, callback) => {
			        if (typeof callback === "function") {
			          callback(true);
			        }
			        return Promise.resolve(true);
			      },
			      getAll: () => {
			        return Promise.resolve({
			          permissions: EXTENSION_PERMISSIONS,
			          origins: ORIGIN_PERMISSIONS,
			        });
			      },
			      onAdded: createNoopListeners(),
			      onRemoved: createNoopListeners(),
			    },
			    i18n: {
			      getUILanguage: () => {
			        return USED_LOCALE || "en";
			      },
			      getMessage: (key, substitutions = []) => {
			        if (typeof substitutions === "string") {
			          substitutions = [substitutions];
			        }
			        if (typeof LOCALE_KEYS !== "undefined" && LOCALE_KEYS[key]) {
			          return LOCALE_KEYS[key].message?.replace(
			            /\$(\d+)/g,
			            (match, p1) => substitutions[p1 - 1] || match,
			          );
			        }
			        return key;
			      },
			    },
			    alarms: {
			      onAlarm: createNoopListeners(),
			      create: () => {
			        _log("alarms.create", arguments);
			      },
			      get: () => {
			        _log("alarms.get", arguments);
			      },
			    },
			    runtime: {
			      ...RUNTIME,
			      onInstalled: createNoopListeners(),
			      onStartup: createNoopListeners(),
			      // TODO: Postmessage to parent to open options page or call openOptionsPage
			      openOptionsPage: () => {
			        // const url = chrome.runtime.getURL(OPTIONS_PAGE_PATH);
			        // console.log("openOptionsPage", _openTab, url, EXTENSION_ASSETS_MAP);
			        // _openTab(url);
			        if (typeof openOptionsPage === "function") {
			          openOptionsPage();
			        } else if (window.parent) {
			          window.parent.postMessage({ type: "openOptionsPage" }, "*");
			        } else {
			          _warn("openOptionsPage not available.");
			        }
			      },
			      getManifest: () => {
			        // The manifest object will be injected into the scope where buildPolyfill is called
			        if (typeof INJECTED_MANIFEST !== "undefined") {
			          return JSON.parse(JSON.stringify(INJECTED_MANIFEST)); // Return deep copy
			        }
			        _warn("INJECTED_MANIFEST not found for chrome.runtime.getManifest");
			        return { name: "Unknown", version: "0.0", manifest_version: 2 };
			      },
			      getURL: (path) => {
			        if (!path) return "";
			        if (path.startsWith("/")) {
			          path = path.substring(1);
			        }
			
			        if (typeof _createAssetUrl === "function") {
			          return _createAssetUrl(path);
			        }
			
			        _warn(
			          `chrome.runtime.getURL fallback for '${path}'. Assets may not be available.`,
			        );
			        // Attempt a relative path resolution (highly context-dependent and likely wrong)
			        try {
			          if (window.location.protocol.startsWith("http")) {
			            return new URL(path, window.location.href).toString();
			          }
			        } catch (e) {
			          /* ignore error, fallback */
			        }
			        return path;
			      },
			      id: "polyfilled-extension-" + Math.random().toString(36).substring(2, 15),
			      lastError: null,
			      setUninstallURL: () => {},
			      setUpdateURL: () => {},
			      getPlatformInfo: async () => {
			        const platform = {
			          os: "unknown",
			          arch: "unknown",
			          nacl_arch: "unknown",
			        };
			
			        if (typeof navigator !== "undefined") {
			          const userAgent = navigator.userAgent.toLowerCase();
			          if (userAgent.includes("mac")) platform.os = "mac";
			          else if (userAgent.includes("win")) platform.os = "win";
			          else if (userAgent.includes("linux")) platform.os = "linux";
			          else if (userAgent.includes("android")) platform.os = "android";
			          else if (userAgent.includes("ios")) platform.os = "ios";
			
			          if (userAgent.includes("x86_64") || userAgent.includes("amd64")) {
			            platform.arch = "x86-64";
			          } else if (userAgent.includes("i386") || userAgent.includes("i686")) {
			            platform.arch = "x86-32";
			          } else if (userAgent.includes("arm")) {
			            platform.arch = "arm";
			          }
			        }
			
			        return platform;
			      },
			      getBrowserInfo: async () => {
			        const info = {
			          name: "unknown",
			          version: "unknown",
			          buildID: "unknown",
			        };
			
			        if (typeof navigator !== "undefined") {
			          const userAgent = navigator.userAgent;
			          if (userAgent.includes("Chrome")) {
			            info.name = "Chrome";
			            const match = userAgent.match(/Chrome\/([0-9.]+)/);
			            if (match) info.version = match[1];
			          } else if (userAgent.includes("Firefox")) {
			            info.name = "Firefox";
			            const match = userAgent.match(/Firefox\/([0-9.]+)/);
			            if (match) info.version = match[1];
			          } else if (userAgent.includes("Safari")) {
			            info.name = "Safari";
			            const match = userAgent.match(/Version\/([0-9.]+)/);
			            if (match) info.version = match[1];
			          }
			        }
			
			        return info;
			      },
			    },
			    storage: {
			      local: {
			        get: function (keys, callback) {
			          if (typeof _storageGet !== "function")
			            throw new Error("_storageGet not defined");
			
			          const promise = _storageGet(keys);
			
			          if (typeof callback === "function") {
			            promise
			              .then((result) => {
			                try {
			                  callback(result);
			                } catch (e) {
			                  _error("Error in storage.get callback:", e);
			                }
			              })
			              .catch((error) => {
			                _error("Storage.get error:", error);
			                callback({});
			              });
			            return;
			          }
			
			          return promise;
			        },
			        set: function (items, callback) {
			          if (typeof _storageSet !== "function")
			            throw new Error("_storageSet not defined");
			
			          const promise = _storageSet(items).then((result) => {
			            broadcastStorageChange(items, "local");
			            return result;
			          });
			
			          if (typeof callback === "function") {
			            promise
			              .then((result) => {
			                try {
			                  callback(result);
			                } catch (e) {
			                  _error("Error in storage.set callback:", e);
			                }
			              })
			              .catch((error) => {
			                _error("Storage.set error:", error);
			                callback();
			              });
			            return;
			          }
			
			          return promise;
			        },
			        remove: function (keys, callback) {
			          if (typeof _storageRemove !== "function")
			            throw new Error("_storageRemove not defined");
			
			          const promise = _storageRemove(keys).then((result) => {
			            const changes = {};
			            const keyList = Array.isArray(keys) ? keys : [keys];
			            keyList.forEach((key) => {
			              changes[key] = { oldValue: undefined, newValue: undefined };
			            });
			            broadcastStorageChange(changes, "local");
			            return result;
			          });
			
			          if (typeof callback === "function") {
			            promise
			              .then((result) => {
			                try {
			                  callback(result);
			                } catch (e) {
			                  _error("Error in storage.remove callback:", e);
			                }
			              })
			              .catch((error) => {
			                _error("Storage.remove error:", error);
			                callback();
			              });
			            return;
			          }
			
			          return promise;
			        },
			        clear: function (callback) {
			          if (typeof _storageClear !== "function")
			            throw new Error("_storageClear not defined");
			
			          const promise = _storageClear().then((result) => {
			            broadcastStorageChange({}, "local");
			            return result;
			          });
			
			          if (typeof callback === "function") {
			            promise
			              .then((result) => {
			                try {
			                  callback(result);
			                } catch (e) {
			                  _error("Error in storage.clear callback:", e);
			                }
			              })
			              .catch((error) => {
			                _error("Storage.clear error:", error);
			                callback();
			              });
			            return;
			          }
			
			          return promise;
			        },
			        onChanged: {
			          addListener: (callback) => {
			            storageChangeListeners.add(callback);
			          },
			          removeListener: (callback) => {
			            storageChangeListeners.delete(callback);
			          },
			        },
			      },
			      sync: {
			        get: function (keys, callback) {
			          _warn("chrome.storage.sync polyfill maps to local");
			          return chrome.storage.local.get(keys, callback);
			        },
			        set: function (items, callback) {
			          _warn("chrome.storage.sync polyfill maps to local");
			
			          const promise = chrome.storage.local.set(items).then((result) => {
			            broadcastStorageChange(items, "sync");
			            return result;
			          });
			
			          if (typeof callback === "function") {
			            promise
			              .then((result) => {
			                try {
			                  callback(result);
			                } catch (e) {
			                  _error("Error in storage.sync.set callback:", e);
			                }
			              })
			              .catch((error) => {
			                _error("Storage.sync.set error:", error);
			                callback();
			              });
			            return;
			          }
			
			          return promise;
			        },
			        remove: function (keys, callback) {
			          _warn("chrome.storage.sync polyfill maps to local");
			
			          const promise = chrome.storage.local.remove(keys).then((result) => {
			            const changes = {};
			            const keyList = Array.isArray(keys) ? keys : [keys];
			            keyList.forEach((key) => {
			              changes[key] = { oldValue: undefined, newValue: undefined };
			            });
			            broadcastStorageChange(changes, "sync");
			            return result;
			          });
			
			          if (typeof callback === "function") {
			            promise
			              .then((result) => {
			                try {
			                  callback(result);
			                } catch (e) {
			                  _error("Error in storage.sync.remove callback:", e);
			                }
			              })
			              .catch((error) => {
			                _error("Storage.sync.remove error:", error);
			                callback();
			              });
			            return;
			          }
			
			          return promise;
			        },
			        clear: function (callback) {
			          _warn("chrome.storage.sync polyfill maps to local");
			
			          const promise = chrome.storage.local.clear().then((result) => {
			            broadcastStorageChange({}, "sync");
			            return result;
			          });
			
			          if (typeof callback === "function") {
			            promise
			              .then((result) => {
			                try {
			                  callback(result);
			                } catch (e) {
			                  _error("Error in storage.sync.clear callback:", e);
			                }
			              })
			              .catch((error) => {
			                _error("Storage.sync.clear error:", error);
			                callback();
			              });
			            return;
			          }
			
			          return promise;
			        },
			        onChanged: {
			          addListener: (callback) => {
			            storageChangeListeners.add(callback);
			          },
			          removeListener: (callback) => {
			            storageChangeListeners.delete(callback);
			          },
			        },
			      },
			      onChanged: {
			        addListener: (callback) => {
			          storageChangeListeners.add(callback);
			        },
			        removeListener: (callback) => {
			          storageChangeListeners.delete(callback);
			        },
			      },
			      managed: {
			        get: function (keys, callback) {
			          _warn("chrome.storage.managed polyfill is read-only empty.");
			
			          const promise = Promise.resolve({});
			
			          if (typeof callback === "function") {
			            promise.then((result) => {
			              try {
			                callback(result);
			              } catch (e) {
			                _error("Error in storage.managed.get callback:", e);
			              }
			            });
			            return;
			          }
			
			          return promise;
			        },
			      },
			    },
			    cookies: (function () {
			      const cookieChangeListeners = new Set();
			      function broadcastCookieChange(changeInfo) {
			        cookieChangeListeners.forEach((listener) => {
			          try {
			            listener(changeInfo);
			          } catch (e) {
			            _error("Error in cookies.onChanged listener:", e);
			          }
			        });
			      }
			
			      function handlePromiseCallback(promise, callback) {
			        if (typeof callback === "function") {
			          promise
			            .then((result) => callback(result))
			            .catch((error) => {
			              // chrome.runtime.lastError = { message: error.message }; // TODO: Implement lastError
			              _error(error);
			              callback(); // Call with undefined on error
			            });
			          return;
			        }
			        return promise;
			      }
			
			      return {
			        get: function (details, callback) {
			          if (typeof _cookieList !== "function") {
			            return handlePromiseCallback(
			              Promise.reject(new Error("_cookieList not defined")),
			              callback,
			            );
			          }
			          const promise = _cookieList({
			            url: details.url,
			            name: details.name,
			            storeId: details.storeId,
			            partitionKey: details.partitionKey,
			          }).then((cookies) => {
			            if (!cookies || cookies.length === 0) {
			              return null;
			            }
			            // Sort by path length (longest first), then creation time (earliest first, if available)
			            cookies.sort((a, b) => {
			              const pathLenDiff = (b.path || "").length - (a.path || "").length;
			              if (pathLenDiff !== 0) return pathLenDiff;
			              return (a.creationTime || 0) - (b.creationTime || 0);
			            });
			            return cookies[0];
			          });
			          return handlePromiseCallback(promise, callback);
			        },
			
			        getAll: function (details, callback) {
			          if (typeof _cookieList !== "function") {
			            return handlePromiseCallback(
			              Promise.reject(new Error("_cookieList not defined")),
			              callback,
			            );
			          }
			          if (details.partitionKey) {
			            _warn(
			              "cookies.getAll: partitionKey is not fully supported in this environment.",
			            );
			          }
			          const promise = _cookieList(details);
			          return handlePromiseCallback(promise, callback);
			        },
			
			        set: function (details, callback) {
			          const promise = (async () => {
			            if (
			              typeof _cookieSet !== "function" ||
			              typeof _cookieList !== "function"
			            ) {
			              throw new Error("_cookieSet or _cookieList not defined");
			            }
			            if (details.partitionKey) {
			              _warn(
			                "cookies.set: partitionKey is not fully supported in this environment.",
			              );
			            }
			
			            const getDetails = {
			              url: details.url,
			              name: details.name,
			              storeId: details.storeId,
			            };
			            const oldCookies = await _cookieList(getDetails);
			            const oldCookie = oldCookies && oldCookies[0];
			
			            if (oldCookie) {
			              broadcastCookieChange({
			                cause: "overwrite",
			                cookie: oldCookie,
			                removed: true,
			              });
			            }
			
			            await _cookieSet(details);
			            const newCookies = await _cookieList(getDetails);
			            const newCookie = newCookies && newCookies[0];
			
			            if (newCookie) {
			              broadcastCookieChange({
			                cause: "explicit",
			                cookie: newCookie,
			                removed: false,
			              });
			            }
			            return newCookie || null;
			          })();
			          return handlePromiseCallback(promise, callback);
			        },
			
			        remove: function (details, callback) {
			          const promise = (async () => {
			            if (
			              typeof _cookieDelete !== "function" ||
			              typeof _cookieList !== "function"
			            ) {
			              throw new Error("_cookieDelete or _cookieList not defined");
			            }
			            const oldCookies = await _cookieList(details);
			            const oldCookie = oldCookies && oldCookies[0];
			
			            if (!oldCookie) return null; // Nothing to remove
			
			            await _cookieDelete(details);
			
			            broadcastCookieChange({
			              cause: "explicit",
			              cookie: oldCookie,
			              removed: true,
			            });
			
			            return {
			              url: details.url,
			              name: details.name,
			              storeId: details.storeId || "0",
			              partitionKey: details.partitionKey,
			            };
			          })();
			          return handlePromiseCallback(promise, callback);
			        },
			
			        getAllCookieStores: function (callback) {
			          const promise = Promise.resolve([
			            { id: "0", tabIds: [1] }, // Mock store for the current context
			          ]);
			          return handlePromiseCallback(promise, callback);
			        },
			
			        getPartitionKey: function (details, callback) {
			          _warn(
			            "chrome.cookies.getPartitionKey is not supported in this environment.",
			          );
			          const promise = Promise.resolve({ partitionKey: {} }); // Return empty partition key
			          return handlePromiseCallback(promise, callback);
			        },
			
			        onChanged: {
			          addListener: (callback) => {
			            if (typeof callback === "function") {
			              cookieChangeListeners.add(callback);
			            }
			          },
			          removeListener: (callback) => {
			            cookieChangeListeners.delete(callback);
			          },
			        },
			      };
			    })(),
			    tabs: {
			      query: async (queryInfo) => {
			        _warn("chrome.tabs.query polyfill only returns current tab info.");
			        const dummyId = Math.floor(Math.random() * 1000) + 1;
			        return [
			          {
			            id: dummyId,
			            url: CURRENT_LOCATION,
			            active: true,
			            windowId: 1,
			            status: "complete",
			          },
			        ];
			      },
			      create: async ({ url, active = true }) => {
			        _log(`[Polyfill tabs.create] URL: ${url}`);
			        if (typeof _openTab !== "function")
			          throw new Error("_openTab not defined");
			        _openTab(url, active);
			        const dummyId = Math.floor(Math.random() * 1000) + 1001;
			        return Promise.resolve({
			          id: dummyId,
			          url: url,
			          active,
			          windowId: 1,
			        });
			      },
			      sendMessage: async (tabId, message) => {
			        _warn(
			          `chrome.tabs.sendMessage polyfill (to tab ${tabId}) redirects to runtime.sendMessage (current context).`,
			        );
			        return chrome.runtime.sendMessage(message);
			      },
			      onActivated: createNoopListeners(),
			      onUpdated: createNoopListeners(),
			      onRemoved: createNoopListeners(),
			      onReplaced: createNoopListeners(),
			      onCreated: createNoopListeners(),
			      onMoved: createNoopListeners(),
			      onDetached: createNoopListeners(),
			      onAttached: createNoopListeners(),
			    },
			    windows: {
			      onFocusChanged: createNoopListeners(),
			      onCreated: createNoopListeners(),
			      onRemoved: createNoopListeners(),
			      onFocused: createNoopListeners(),
			      onFocus: createNoopListeners(),
			      onBlur: createNoopListeners(),
			      onFocused: createNoopListeners(),
			    },
			    notifications: {
			      create: async (notificationId, options) => {
			        try {
			          let id = notificationId;
			          let notificationOptions = options;
			
			          if (typeof notificationId === "object" && notificationId !== null) {
			            notificationOptions = notificationId;
			            id = "notification_" + Math.random().toString(36).substring(2, 15);
			          } else if (typeof notificationId === "string" && options) {
			            id = notificationId;
			            notificationOptions = options;
			          } else {
			            throw new Error("Invalid parameters for notifications.create");
			          }
			
			          if (!notificationOptions || typeof notificationOptions !== "object") {
			            throw new Error("Notification options must be an object");
			          }
			
			          const {
			            title,
			            message,
			            iconUrl,
			            type = "basic",
			          } = notificationOptions;
			
			          if (!title || !message) {
			            throw new Error("Notification must have title and message");
			          }
			
			          if ("Notification" in window) {
			            if (Notification.permission === "granted") {
			              const notification = new Notification(title, {
			                body: message,
			                icon: iconUrl,
			                tag: id,
			              });
			
			              _log(`[Notifications] Created notification: ${id}`);
			              return id;
			            } else if (Notification.permission === "default") {
			              const permission = await Notification.requestPermission();
			              if (permission === "granted") {
			                const notification = new Notification(title, {
			                  body: message,
			                  icon: iconUrl,
			                  tag: id,
			                });
			                _log(
			                  `[Notifications] Created notification after permission: ${id}`,
			                );
			                return id;
			              } else {
			                _warn("[Notifications] Permission denied for notifications");
			                return id;
			              }
			            } else {
			              _warn("[Notifications] Notifications are blocked");
			              return id;
			            }
			          } else {
			            _warn(
			              "[Notifications] Native notifications not supported, using console fallback",
			            );
			            _log(`[Notification] ${title}: ${message}`);
			            return id;
			          }
			        } catch (error) {
			          _error("[Notifications] Error creating notification:", error.message);
			          throw error;
			        }
			      },
			      clear: async (notificationId) => {
			        _log(`[Notifications] Clear notification: ${notificationId}`);
			        // For native notifications, there's no direct way to clear by ID
			        // This is a limitation of the Web Notifications API
			        return true;
			      },
			      getAll: async () => {
			        _warn("[Notifications] getAll not fully supported in polyfill");
			        return {};
			      },
			      getPermissionLevel: async () => {
			        if ("Notification" in window) {
			          const permission = Notification.permission;
			          return { level: permission === "granted" ? "granted" : "denied" };
			        }
			        return { level: "denied" };
			      },
			    },
			    contextMenus: {
			      create: (createProperties, callback) => {
			        try {
			          if (!createProperties || typeof createProperties !== "object") {
			            throw new Error("Context menu create properties must be an object");
			          }
			
			          const { id, title, contexts = ["page"], onclick } = createProperties;
			          const menuId =
			            id || `menu_${Math.random().toString(36).substring(2, 15)}`;
			
			          if (!title || typeof title !== "string") {
			            throw new Error("Context menu must have a title");
			          }
			
			          // Store menu items for potential use
			          if (!window._polyfillContextMenus) {
			            window._polyfillContextMenus = new Map();
			          }
			
			          window._polyfillContextMenus.set(menuId, {
			            id: menuId,
			            title,
			            contexts,
			            onclick,
			            enabled: createProperties.enabled !== false,
			          });
			
			          _log(
			            `[ContextMenus] Created context menu item: ${title} (${menuId})`,
			          );
			
			          // Try to register a menu command as fallback
			          if (typeof _registerMenuCommand === "function") {
			            try {
			              _registerMenuCommand(
			                title,
			                onclick ||
			                  (() => {
			                    _log(`Context menu clicked: ${title}`);
			                  }),
			              );
			            } catch (e) {
			              _warn(
			                "[ContextMenus] Failed to register as menu command:",
			                e.message,
			              );
			            }
			          }
			
			          if (callback && typeof callback === "function") {
			            setTimeout(() => callback(), 0);
			          }
			
			          return menuId;
			        } catch (error) {
			          _error("[ContextMenus] Error creating context menu:", error.message);
			          if (callback && typeof callback === "function") {
			            setTimeout(() => callback(), 0);
			          }
			          throw error;
			        }
			      },
			      update: (id, updateProperties, callback) => {
			        try {
			          if (
			            !window._polyfillContextMenus ||
			            !window._polyfillContextMenus.has(id)
			          ) {
			            throw new Error(`Context menu item not found: ${id}`);
			          }
			
			          const menuItem = window._polyfillContextMenus.get(id);
			          Object.assign(menuItem, updateProperties);
			
			          _log(`[ContextMenus] Updated context menu item: ${id}`);
			
			          if (callback && typeof callback === "function") {
			            setTimeout(() => callback(), 0);
			          }
			        } catch (error) {
			          _error("[ContextMenus] Error updating context menu:", error.message);
			          if (callback && typeof callback === "function") {
			            setTimeout(() => callback(), 0);
			          }
			        }
			      },
			      remove: (menuItemId, callback) => {
			        try {
			          if (
			            window._polyfillContextMenus &&
			            window._polyfillContextMenus.has(menuItemId)
			          ) {
			            window._polyfillContextMenus.delete(menuItemId);
			            _log(`[ContextMenus] Removed context menu item: ${menuItemId}`);
			          } else {
			            _warn(
			              `[ContextMenus] Context menu item not found for removal: ${menuItemId}`,
			            );
			          }
			
			          if (callback && typeof callback === "function") {
			            setTimeout(() => callback(), 0);
			          }
			        } catch (error) {
			          _error("[ContextMenus] Error removing context menu:", error.message);
			          if (callback && typeof callback === "function") {
			            setTimeout(() => callback(), 0);
			          }
			        }
			      },
			      removeAll: (callback) => {
			        try {
			          if (window._polyfillContextMenus) {
			            const count = window._polyfillContextMenus.size;
			            window._polyfillContextMenus.clear();
			            _log(`[ContextMenus] Removed all ${count} context menu items`);
			          }
			
			          if (callback && typeof callback === "function") {
			            setTimeout(() => callback(), 0);
			          }
			        } catch (error) {
			          _error(
			            "[ContextMenus] Error removing all context menus:",
			            error.message,
			          );
			          if (callback && typeof callback === "function") {
			            setTimeout(() => callback(), 0);
			          }
			        }
			      },
			      onClicked: {
			        addListener: (callback) => {
			          if (!window._polyfillContextMenuListeners) {
			            window._polyfillContextMenuListeners = new Set();
			          }
			          window._polyfillContextMenuListeners.add(callback);
			          _log("[ContextMenus] Added click listener");
			        },
			        removeListener: (callback) => {
			          if (window._polyfillContextMenuListeners) {
			            window._polyfillContextMenuListeners.delete(callback);
			            _log("[ContextMenus] Removed click listener");
			          }
			        },
			      },
			    },
			  };
			
			  const tc = (fn) => {
			    try {
			      fn();
			    } catch (e) {}
			  };
			  const loggingProxyHandler = (_key) => ({
			    get(target, key, receiver) {
			      tc(() => _log(`[${contextType}] [CHROME - ${_key}] Getting ${key}`));
			      return Reflect.get(target, key, receiver);
			    },
			    set(target, key, value, receiver) {
			      tc(() =>
			        _log(`[${contextType}] [CHROME - ${_key}] Setting ${key} to ${value}`),
			      );
			      return Reflect.set(target, key, value, receiver);
			    },
			    has(target, key) {
			      tc(() =>
			        _log(`[${contextType}] [CHROME - ${_key}] Checking if ${key} exists`),
			      );
			      return Reflect.has(target, key);
			    },
			  });
			  chrome = Object.fromEntries(
			    Object.entries(chrome).map(([key, value]) => [
			      key,
			      new Proxy(value, loggingProxyHandler(key)),
			    ]),
			  );
			
			  // Alias browser to chrome for common Firefox pattern
			  const browser = new Proxy(chrome, loggingProxyHandler);
			
			  const oldGlobalThis = globalThis;
			  const oldWindow = window;
			  const oldSelf = self;
			  const oldGlobal = globalThis;
			  const __globalsStorage = {};
			
			  const TO_MODIFY = [oldGlobalThis, oldWindow, oldSelf, oldGlobal];
			  const set = (k, v) => {
			    __globalsStorage[k] = v;
			    TO_MODIFY.forEach((target) => {
			      target[k] = v;
			    });
			  };
			  const proxyHandler = {
			    get(target, key, receiver) {
			      const fns = [
			        () => __globalsStorage[key],
			        () => Reflect.get(target, key, target),
			        () => target[key],
			      ];
			      const out = fns
			        .map((f) => {
			          try {
			            let out = f();
			            return out;
			          } catch (e) {
			            return undefined;
			          }
			        })
			        .find((f) => f !== undefined);
			      if (typeof out === "function") {
			        return out.bind(target);
			      }
			      return out;
			    },
			    set(target, key, value, receiver) {
			      try {
			        tc(() => _log(`[${contextType}] Setting ${key} to ${value}`));
			        set(key, value);
			        return Reflect.set(target, key, value, receiver);
			      } catch (e) {
			        _error("Error setting", key, value, e);
			        try {
			          target[key] = value;
			          return true;
			        } catch (e) {
			          _error("Error setting", key, value, e);
			        }
			        return false;
			      }
			    },
			    has(target, key) {
			      try {
			        return key in __globalsStorage || key in target;
			      } catch (e) {
			        _error("Error has", key, e);
			        try {
			          return key in __globalsStorage || key in target;
			        } catch (e) {
			          _error("Error has", key, e);
			        }
			        return false;
			      }
			    },
			    getOwnPropertyDescriptor(target, key) {
			      try {
			        if (key in __globalsStorage) {
			          return {
			            configurable: true,
			            enumerable: true,
			            writable: true,
			            value: __globalsStorage[key],
			          };
			        }
			        // fall back to the real globalThis
			        const desc = Reflect.getOwnPropertyDescriptor(target, key);
			        // ensure it's configurable so the with‑scope binding logic can override it
			        if (desc && !desc.configurable) {
			          desc.configurable = true;
			        }
			        return desc;
			      } catch (e) {
			        _error("Error getOwnPropertyDescriptor", key, e);
			        return {
			          configurable: true,
			          enumerable: true,
			          writable: true,
			          value: undefined,
			        };
			      }
			    },
			
			    defineProperty(target, key, descriptor) {
			      try {
			        // Normalize descriptor to avoid mixed accessor & data attributes
			        const hasAccessor = "get" in descriptor || "set" in descriptor;
			
			        if (hasAccessor) {
			          // Build a clean descriptor without value/writable when accessors present
			          const normalized = {
			            configurable:
			              "configurable" in descriptor ? descriptor.configurable : true,
			            enumerable:
			              "enumerable" in descriptor ? descriptor.enumerable : false,
			          };
			          if ("get" in descriptor) normalized.get = descriptor.get;
			          if ("set" in descriptor) normalized.set = descriptor.set;
			
			          // Store accessor references for inspection but avoid breaking invariants
			          set(key, {
			            get: descriptor.get,
			            set: descriptor.set,
			          });
			
			          return Reflect.defineProperty(target, key, normalized);
			        }
			
			        // Data descriptor path
			        set(key, descriptor.value);
			        return Reflect.defineProperty(target, key, descriptor);
			      } catch (e) {
			        _error("Error defineProperty", key, descriptor, e);
			        return false;
			      }
			    },
			  };
			
			  // Create proxies once proxyHandler is defined
			  const proxyWindow = new Proxy(oldWindow, proxyHandler);
			  const proxyGlobalThis = new Proxy(oldGlobalThis, proxyHandler);
			  const proxyGlobal = new Proxy(oldGlobal, proxyHandler);
			  const proxySelf = new Proxy(oldSelf, proxyHandler);
			
			  // Seed storage with core globals so lookups succeed inside `with` blocks
			  Object.assign(__globalsStorage, {
			    chrome,
			    browser,
			    window: proxyWindow,
			    globalThis: proxyGlobalThis,
			    global: proxyGlobal,
			    self: proxySelf,
			    document: oldWindow.document,
			  });
			
			  const __globals = {
			    chrome,
			    browser,
			    window: proxyWindow,
			    globalThis: proxyGlobalThis,
			    global: proxyGlobal,
			    self: proxySelf,
			    __globals: __globalsStorage,
			  };
			
			  __globals.contextId = contextId;
			  __globals.contextType = contextType;
			  __globals.module = undefined;
			  __globals.amd = undefined;
			  __globals.define = undefined;
			  __globals.importScripts = (...args) => {
			    _log("importScripts", args);
			  };
			
			  return __globals;
			}
			
			
			if (typeof window !== 'undefined') {
			    window.buildPolyfill = buildPolyfill;
			}
			
  // #endregion
// #endregion
    // #endregion
   // #region Background Script Environment
	
	const START_BACKGROUND_SCRIPT = (function(){
	  const backgroundPolyfill = buildPolyfill({ isBackground: true });
	  const scriptName = "e621 extras";
	  const debug = "[e621 extras]";
	  _log(debug + ' Executing background scripts...');
	
	  function executeBackgroundScripts(){
	    with(backgroundPolyfill){
	      // BG: background.js
	/* Service worker: manages tag script queue, IndexedDB image storage,
	 * and background tag script execution without requiring open tabs. */
	importScripts('scripts/constants.js');
	
	const { ACTIONS, STORAGE_KEYS: KEYS } = E621_CONSTANTS;
	const ALLOWED_HOST = /^(?:[a-z0-9-]+\.)*e(?:621|926)\.net$/i;
	const BASE64_CHUNK = 0x8000;
	const HOURLY_EDIT_LIMIT = 150;
	const ONE_HOUR_MS = 60 * 60 * 1000;
	const CLOCK_BUFFER_MS = 3000;
	
	// ---------- IndexedDB image store ----------
	const DB_NAME = 'e621_extras_db';
	const DB_VERSION = 1;
	const STORE_NAME = 'post_images';
	
	function openDatabase() {
	  return new Promise((resolve, reject) => {
	    const req = indexedDB.open(DB_NAME, DB_VERSION);
	    req.onupgradeneeded = () => {
	      const db = req.result;
	      if (!db.objectStoreNames.contains(STORE_NAME)) {
	        db.createObjectStore(STORE_NAME, { keyPath: 'postId' });
	      }
	    };
	    req.onsuccess = () => resolve(req.result);
	    req.onerror = () => reject(req.error);
	  });
	}
	
	async function idbSaveImage(postId, dataUrl) {
	  if (!dataUrl) return;
	  const db = await openDatabase();
	  return new Promise((resolve, reject) => {
	    const tx = db.transaction(STORE_NAME, 'readwrite');
	    tx.objectStore(STORE_NAME).put({ postId: Number(postId), dataUrl, savedAt: Date.now() });
	    tx.oncomplete = () => resolve();
	    tx.onerror = () => reject(tx.error);
	  });
	}
	
	async function idbGetImage(postId) {
	  const db = await openDatabase();
	  return new Promise((resolve, reject) => {
	    const tx = db.transaction(STORE_NAME, 'readonly');
	    const req = tx.objectStore(STORE_NAME).get(Number(postId));
	    req.onsuccess = () => resolve(req.result?.dataUrl || null);
	    req.onerror = () => reject(req.error);
	  });
	}
	
	async function idbDeleteImage(postId) {
	  const db = await openDatabase();
	  return new Promise((resolve, reject) => {
	    const tx = db.transaction(STORE_NAME, 'readwrite');
	    tx.objectStore(STORE_NAME).delete(Number(postId));
	    tx.oncomplete = () => resolve();
	    tx.onerror = () => reject(tx.error);
	  });
	}
	
	async function idbClearImages() {
	  const db = await openDatabase();
	  return new Promise((resolve, reject) => {
	    const tx = db.transaction(STORE_NAME, 'readwrite');
	    tx.objectStore(STORE_NAME).clear();
	    tx.oncomplete = () => resolve();
	    tx.onerror = () => reject(tx.error);
	  });
	}
	
	// ---------- Image fetch helpers ----------
	function toBase64(bytes) {
	  let binary = '';
	  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
	    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + BASE64_CHUNK));
	  }
	  return btoa(binary);
	}
	
	async function fetchImageAsDataUrl(rawUrl) {
	  const url = new URL(rawUrl);
	  if (url.protocol !== 'https:' || !ALLOWED_HOST.test(url.hostname)) {
	    throw new Error('Host not allowed');
	  }
	  const res = await fetch(url.href);
	  if (!res.ok) throw new Error(`HTTP ${res.status}`);
	  const type = res.headers.get('content-type') || '';
	  if (!type.startsWith('image/')) throw new Error('Not an image');
	  const bytes = new Uint8Array(await res.arrayBuffer());
	  return `data:${type};base64,${toBase64(bytes)}`;
	}
	
	// ---------- Queue synchronization mutex ----------
	let queueTail = Promise.resolve();
	function runQueueOp(task) {
	  const next = queueTail.then(task);
	  queueTail = next.catch(err => console.warn('[background] queueOp error:', err));
	  return next;
	}
	
	// ---------- CSRF token management ----------
	async function getCsrfToken(forceFresh = false) {
	  if (!forceFresh && chrome.storage?.session) {
	    try {
	      const data = await chrome.storage.session.get('csrfToken');
	      if (data?.csrfToken) return data.csrfToken;
	    } catch (err) {
	      console.warn('[background] Failed to read csrfToken from storage.session:', err);
	    }
	  }
	
	  try {
	    // Lightweight fallback: root page HTML is significantly smaller than /posts
	    const res = await fetch('https://e621.net/', { credentials: 'include' });
	    if (!res.ok) return null;
	    const html = await res.text();
	    const match = html.match(/<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']/i);
	    if (match?.[1]) {
	      const token = match[1];
	      if (chrome.storage?.session) {
	        await chrome.storage.session.set({ csrfToken: token }).catch(() => {});
	      }
	      return token;
	    }
	  } catch (err) {
	    console.warn('[background] Failed to fetch CSRF token:', err);
	  }
	  return null;
	}
	
	// ---------- Broadcast post status to tabs ----------
	async function broadcastPostStatus(postId, status, error = '') {
	  try {
	    const tabs = await chrome.tabs.query({ url: ['https://e621.net/*', 'https://e926.net/*'] });
	    for (const tab of tabs) {
	      chrome.tabs.sendMessage(tab.id, {
	        action: ACTIONS.TAG_SCRIPT_POST_STATUS,
	        postId: Number(postId),
	        status,
	        error
	      }).catch(() => {});
	    }
	  } catch (err) {
	    console.warn('[background] broadcastPostStatus error:', err);
	  }
	}
	
	// ---------- Queue state operations ----------
	function mergeDiffs(oldDiff = '', newDiff = '') {
	  const tokenMap = new Map();
	  const parse = (str) => String(str || '').split(/\s+/).filter(Boolean);
	
	  parse(oldDiff).forEach(token => {
	    const key = token.startsWith('-') ? token.slice(1).toLowerCase() : token.toLowerCase();
	    tokenMap.set(key, token);
	  });
	
	  parse(newDiff).forEach(token => {
	    const key = token.startsWith('-') ? token.slice(1).toLowerCase() : token.toLowerCase();
	    tokenMap.set(key, token);
	  });
	
	  return Array.from(tokenMap.values()).join(' ');
	}
	
	async function enqueuePost(postId, editData) {
	  const id = Number(postId);
	  const data = await chrome.storage.local.get([KEYS.TAG_SCRIPT_QUEUE]);
	  const queue = data[KEYS.TAG_SCRIPT_QUEUE] || {};
	  const existing = queue[id];
	
	  queue[id] = {
	    id,
	    changes: existing ? mergeDiffs(existing.changes, editData.changes) : editData.changes,
	    reason: editData.reason || existing?.reason || '',
	    queuedAt: existing?.queuedAt || Date.now(),
	    previewUrl: editData.previewUrl || existing?.previewUrl || '',
	    score: editData.score !== undefined ? editData.score : (existing?.score ?? 0),
	    favCount: editData.favCount !== undefined ? editData.favCount : (existing?.favCount ?? 0),
	    commentCount: editData.commentCount !== undefined ? editData.commentCount : (existing?.commentCount ?? 0),
	    rating: editData.rating || existing?.rating || 's',
	    fileExt: editData.fileExt || existing?.fileExt || 'jpg',
	    tags: editData.tags !== undefined ? editData.tags : (existing?.tags || ''),
	    flags: editData.flags !== undefined ? editData.flags : (existing?.flags || ''),
	    hasParent: editData.hasParent !== undefined ? editData.hasParent : (existing?.hasParent ?? false),
	    hasChildren: editData.hasChildren !== undefined ? editData.hasChildren : (existing?.hasChildren ?? false)
	  };
	
	  await chrome.storage.local.set({ [KEYS.TAG_SCRIPT_QUEUE]: queue });
	  return queue;
	}
	
	async function dequeuePost(postId) {
	  const id = Number(postId);
	  const data = await chrome.storage.local.get([KEYS.TAG_SCRIPT_QUEUE]);
	  const queue = data[KEYS.TAG_SCRIPT_QUEUE] || {};
	  if (queue[id]) {
	    delete queue[id];
	    await chrome.storage.local.set({ [KEYS.TAG_SCRIPT_QUEUE]: queue });
	    await idbDeleteImage(id);
	    if (Object.keys(queue).length === 0) {
	      await chrome.storage.local.set({
	        [KEYS.QUEUE_SLOT_TIMESTAMPS]: [],
	        [KEYS.QUEUE_TIMEOUT_UNTIL]: 0
	      });
	    }
	  }
	  return queue;
	}
	
	async function clearTagQueue() {
	  await chrome.storage.local.set({
	    [KEYS.TAG_SCRIPT_QUEUE]: {},
	    [KEYS.QUEUE_SLOT_TIMESTAMPS]: [],
	    [KEYS.QUEUE_TIMEOUT_UNTIL]: 0
	  });
	  await idbClearImages();
	}
	
	// ---------- Background Queue Processor ----------
	function isHourlyLimitResponse(status, errorText) {
	  if (status === 429) return true;
	  if (status === 403) {
	    const msg = String(errorText || '').toLowerCase();
	    return msg.includes('hourly limit') || msg.includes('limit exceeded') || msg.includes('throttl');
	  }
	  return false;
	}
	
	async function verifyHourlyLimitExceeded() {
	  try {
	    const meRes = await fetch('https://e621.net/users/me.json', { credentials: 'include' });
	    if (!meRes.ok) return { isLimit: false, nextAvailableMs: 0, slots: [] };
	    const me = await meRes.json();
	    if (!me?.id) return { isLimit: false, nextAvailableMs: 0, slots: [] };
	
	    const url = `https://e621.net/post_versions.json?search[updater_id]=${me.id}&limit=${HOURLY_EDIT_LIMIT}`;
	    const vRes = await fetch(url, { credentials: 'include' });
	    if (!vRes.ok) return { isLimit: false, nextAvailableMs: 0, slots: [] };
	    const list = await vRes.json();
	    const versions = Array.isArray(list) ? list : (list?.post_versions || []);
	    const now = Date.now();
	
	    const recentTimestamps = [];
	    for (const item of versions) {
	      const dateStr = item?.updated_at || item?.created_at;
	      if (!dateStr) continue;
	      const t = new Date(dateStr).getTime();
	      if (!Number.isNaN(t) && (now - t) < ONE_HOUR_MS) {
	        recentTimestamps.push(t);
	      }
	    }
	
	    if (recentTimestamps.length < HOURLY_EDIT_LIMIT) {
	      return { isLimit: false, nextAvailableMs: 0, slots: [] };
	    }
	
	    recentTimestamps.sort((a, b) => a - b);
	    const slots = recentTimestamps.map(t => t + ONE_HOUR_MS + CLOCK_BUFFER_MS);
	
	    const data = await chrome.storage.local.get([KEYS.TAG_SCRIPT_QUEUE]);
	    const queue = data[KEYS.TAG_SCRIPT_QUEUE] || {};
	    const queueLen = Math.max(Object.keys(queue).length, slots.length);
	    while (slots.length < queueLen) {
	      const baseIdx = Math.max(0, slots.length - HOURLY_EDIT_LIMIT);
	      slots.push((slots[baseIdx] || now) + ONE_HOUR_MS);
	    }
	
	    const nextAvailableMs = Math.max(1000, slots[0] - now);
	    await chrome.storage.local.set({ [KEYS.QUEUE_SLOT_TIMESTAMPS]: slots });
	    return { isLimit: true, nextAvailableMs, slots };
	  } catch (err) {
	    console.warn('[background] verifyHourlyLimitExceeded error:', err);
	    return { isLimit: false, nextAvailableMs: 0, slots: [] };
	  }
	}
	
	async function processQueueInBackground() {
	  const data = await chrome.storage.local.get([
	    KEYS.QUEUE_TAG_SCRIPTS_ENABLED,
	    KEYS.TAG_SCRIPT_QUEUE,
	    KEYS.QUEUE_TIMEOUT_UNTIL,
	    KEYS.QUEUE_SLOT_TIMESTAMPS
	  ]);
	
	  if (!data[KEYS.QUEUE_TAG_SCRIPTS_ENABLED]) {
	    return { total: 0, updated: 0, errors: 0, disabled: true };
	  }
	
	  const queue = data[KEYS.TAG_SCRIPT_QUEUE] || {};
	  const items = Object.values(queue);
	  if (!items.length) {
	    await chrome.storage.local.set({
	      [KEYS.QUEUE_SLOT_TIMESTAMPS]: [],
	      [KEYS.QUEUE_TIMEOUT_UNTIL]: 0
	    });
	    return { total: 0, updated: 0, errors: 0 };
	  }
	
	  const now = Date.now();
	  let slots = data[KEYS.QUEUE_SLOT_TIMESTAMPS] || [];
	  const scheduledTime = slots[0] || Number(data[KEYS.QUEUE_TIMEOUT_UNTIL]) || 0;
	
	  if (scheduledTime > now) {
	    chrome.alarms.create('tagQueueCheck', { when: scheduledTime + 500 });
	    return { total: items.length, updated: 0, errors: 0, hitLimit: true };
	  }
	
	  let csrf = await getCsrfToken();
	  let updated = 0;
	  let errors = 0;
	  let hitLimit = false;
	
	  for (let i = 0; i < items.length; i++) {
	    const item = items[i];
	    const currentSlots = (await chrome.storage.local.get([KEYS.QUEUE_SLOT_TIMESTAMPS]))[KEYS.QUEUE_SLOT_TIMESTAMPS] || [];
	    const nextSlot = currentSlots[0] || 0;
	
	    if (nextSlot > Date.now()) {
	      hitLimit = true;
	      await chrome.storage.local.set({ [KEYS.QUEUE_TIMEOUT_UNTIL]: nextSlot });
	      chrome.alarms.create('tagQueueCheck', { when: nextSlot + 500 });
	      break;
	    }
	
	    try {
	      let res = await fetch(`https://e621.net/posts/${item.id}.json`, {
	        method: 'PATCH',
	        headers: {
	          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
	          'X-CSRF-Token': csrf || ''
	        },
	        body: new URLSearchParams({
	          'post[tag_string_diff]': item.changes,
	          'post[edit_reason]': item.reason || ''
	        }).toString(),
	        credentials: 'include'
	      });
	
	      if (res.status === 403) {
	        csrf = await getCsrfToken(true);
	        res = await fetch(`https://e621.net/posts/${item.id}.json`, {
	          method: 'PATCH',
	          headers: {
	            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
	            'X-CSRF-Token': csrf || ''
	          },
	          body: new URLSearchParams({
	            'post[tag_string_diff]': item.changes,
	            'post[edit_reason]': item.reason || ''
	          }).toString(),
	          credentials: 'include'
	        });
	      }
	
	      if (!res.ok) {
	        let errorText = '';
	        try {
	          const jsonErr = await res.json();
	          errorText = jsonErr.reason || jsonErr.message || JSON.stringify(jsonErr);
	        } catch (_) {
	          errorText = await res.text().catch(() => '');
	        }
	
	        if (isHourlyLimitResponse(res.status, errorText)) {
	          const check = await verifyHourlyLimitExceeded();
	          const delay = check.isLimit ? check.nextAvailableMs : (res.status === 429 ? 60000 : 30000);
	          const resumeAt = Date.now() + delay;
	          await chrome.storage.local.set({ [KEYS.QUEUE_TIMEOUT_UNTIL]: resumeAt });
	          chrome.alarms.create('tagQueueCheck', { when: resumeAt + 500 });
	          hitLimit = true;
	          break;
	        }
	
	        // Post cannot be edited or tag is locked — dequeue to avoid blocking the queue
	        await dequeuePost(item.id);
	        await broadcastPostStatus(item.id, 'locked', errorText);
	        errors++;
	        continue;
	      }
	
	      // Success: dequeue and notify tabs to turn yellow outline into green
	      await dequeuePost(item.id);
	      await broadcastPostStatus(item.id, 'updated');
	      const remainingSlots = (await chrome.storage.local.get([KEYS.QUEUE_SLOT_TIMESTAMPS]))[KEYS.QUEUE_SLOT_TIMESTAMPS] || [];
	      if (remainingSlots.length > 0) {
	        remainingSlots.shift();
	        await chrome.storage.local.set({ [KEYS.QUEUE_SLOT_TIMESTAMPS]: remainingSlots });
	      }
	      updated++;
	    } catch (err) {
	      console.warn(`[background] Error processing queued post #${item.id}:`, err);
	      errors++;
	    }
	  }
	
	  if (!hitLimit) {
	    const rem = (await chrome.storage.local.get([KEYS.TAG_SCRIPT_QUEUE]))[KEYS.TAG_SCRIPT_QUEUE] || {};
	    if (Object.keys(rem).length === 0) {
	      await chrome.storage.local.set({
	        [KEYS.QUEUE_SLOT_TIMESTAMPS]: [],
	        [KEYS.QUEUE_TIMEOUT_UNTIL]: 0
	      });
	    }
	  }
	
	  return { total: items.length, updated, errors, hitLimit };
	}
	
	// ---------- Message Router ----------
	chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
	  if (sender.id !== chrome.runtime.id) return false;
	
	  switch (msg?.action) {
	    case ACTIONS.FETCH_IMAGE:
	      fetchImageAsDataUrl(msg.url)
	        .then(dataUrl => sendResponse({ ok: true, dataUrl }))
	        .catch(err => sendResponse({ ok: false, error: err.message }));
	      return true;
	
	    case ACTIONS.SAVE_IMAGE:
	      idbSaveImage(msg.postId, msg.dataUrl)
	        .then(() => sendResponse({ ok: true }))
	        .catch(err => sendResponse({ ok: false, error: err.message }));
	      return true;
	
	    case ACTIONS.GET_IMAGE:
	      idbGetImage(msg.postId)
	        .then(dataUrl => sendResponse({ ok: true, dataUrl }))
	        .catch(err => sendResponse({ ok: false, error: err.message }));
	      return true;
	
	    case ACTIONS.DELETE_IMAGE:
	      idbDeleteImage(msg.postId)
	        .then(() => sendResponse({ ok: true }))
	        .catch(err => sendResponse({ ok: false, error: err.message }));
	      return true;
	
	    case ACTIONS.CLEAR_IMAGES:
	      idbClearImages()
	        .then(() => sendResponse({ ok: true }))
	        .catch(err => sendResponse({ ok: false, error: err.message }));
	      return true;
	
	    case ACTIONS.ENQUEUE_TAG_SCRIPT:
	      runQueueOp(() => enqueuePost(msg.postId, msg.editData))
	        .then(queue => sendResponse({ ok: true, queue }))
	        .catch(err => sendResponse({ ok: false, error: err.message }));
	      return true;
	
	    case ACTIONS.DEQUEUE_TAG_SCRIPT:
	      runQueueOp(() => dequeuePost(msg.postId))
	        .then(queue => sendResponse({ ok: true, queue }))
	        .catch(err => sendResponse({ ok: false, error: err.message }));
	      return true;
	
	    case ACTIONS.CLEAR_TAG_QUEUE:
	      runQueueOp(() => clearTagQueue())
	        .then(() => sendResponse({ ok: true }))
	        .catch(err => sendResponse({ ok: false, error: err.message }));
	      return true;
	
	    case ACTIONS.PROCESS_TAG_QUEUE:
	      runQueueOp(() => processQueueInBackground())
	        .then(res => sendResponse({ ok: true, ...res }))
	        .catch(err => sendResponse({ ok: false, error: err.message }));
	      return true;
	
	    case ACTIONS.SET_CSRF_TOKEN:
	      if (msg.csrfToken && chrome.storage?.session) {
	        chrome.storage.session.set({ csrfToken: msg.csrfToken })
	          .then(() => sendResponse({ ok: true }))
	          .catch((err) => {
	            console.warn('[background] Failed to save csrfToken to storage.session:', err);
	            sendResponse({ ok: false, error: err.message });
	          });
	        return true;
	      }
	      sendResponse({ ok: true });
	      return false;
	
	    default:
	      return false;
	  }
	});
	
	// Periodic alarm: triggers background processing even when all e621 tabs are closed
	chrome.alarms.onAlarm.addListener(async (alarm) => {
	  if (alarm.name === 'tagQueueCheck') {
	    await runQueueOp(() => processQueueInBackground());
	  }
	});
	
	function ensureAlarm() {
	  chrome.alarms.get('tagQueueCheck', (alarm) => {
	    if (!alarm) {
	      chrome.alarms.create('tagQueueCheck', { periodInMinutes: 1 });
	    }
	  });
	}
	
	chrome.runtime.onInstalled.addListener(ensureAlarm);
	chrome.runtime.onStartup.addListener(ensureAlarm);
	ensureAlarm();
	    }
	  }
	
	  executeBackgroundScripts.call(backgroundPolyfill);
	
	  _log(debug + ' Background scripts execution complete.');
	});
	
	setTimeout(() => {
	  // Wait for things to be defined
	  START_BACKGROUND_SCRIPT();
	}, 10);
	_log("START_BACKGROUND_SCRIPT", START_BACKGROUND_SCRIPT);
	// End background script environment
	
	
   // #endregion
    // #region Orchestration Logic
	// Other globals currently defined at this spot: SCRIPT_NAME, _log, _warn, _error
	const INJECTED_MANIFEST = {"manifest_version":3,"name":"e621 extras","version":"1.5.4","description":"Downvotes-to-blacklist manager, post tree viewer, hover zoom and tag scripts for regular members of e621 and e926.","permissions":["storage","alarms","unlimitedStorage"],"optional_permissions":[],"content_scripts":[{"matches":["https://e621.net/*","https://e926.net/*"],"css":["styles/extras.css"],"js":["scripts/constants.js","scripts/core.js","scripts/selectors.js","scripts/utils.js","scripts/net.js","scripts/ui/dom.js","scripts/ui/layout.js","scripts/ui/thumbnail.js","scripts/ui/dtext.js","scripts/ui/tooltips.js","scripts/blacklist.js","scripts/uploader.js","scripts/user_edits.js","scripts/tree/data.js","scripts/tree/export.js","scripts/tree/modal.js","scripts/hover_zoom/data.js","scripts/hover_zoom/index.js","scripts/tag_script/engine.js","scripts/tag_script/queue.js","scripts/tag_script/timeouted_page.js","scripts/tag_script/logger.js","scripts/tag_script/storage.js","scripts/tag_script/runner.js","scripts/tag_script/preview.js","scripts/tag_script/index.js","scripts/content.js"],"run_at":"document_end"}],"options_ui":{},"browser_action":{},"page_action":{},"action":{"default_popup":"popup/popup.html","default_title":"e621 extras"},"icons":{},"web_accessible_resources":[],"background":{"service_worker":"background.js"},"_id":"e621-extras"};
	const CONTENT_SCRIPT_CONFIGS_FOR_MATCHING = [
	  {
	    "matches": [
	      "https://e621.net/*",
	      "https://e926.net/*"
	    ]
	  }
	];
	const OPTIONS_PAGE_PATH = null;
	const POPUP_PAGE_PATH = "popup/popup.html";
	const EXTENSION_ICON = null;
	const extensionCssData = {    "styles/extras.css": "/* ===== toast ===== */\r\n.e621x-toast {\r\n  position: fixed; bottom: 24px; right: 24px; z-index: 999999;\r\n  background: #000; color: #fff; border: 1px solid #444;\r\n  padding: 10px 16px; font: 12px/1.4 -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif;\r\n  letter-spacing: 0.3px; pointer-events: none; transition: opacity 0.3s;\r\n}\r\n.e621x-toast--error { background: #1a1a1a; border-color: #ff4444; }\r\n.e621x-toast.is-hiding { opacity: 0; }\r\n\r\n/* ===== thumbnail card (size/fit come from --e621x-* variables set on the container) ===== */\r\n.e621x-thumb {\r\n  margin: 0 !important; float: none !important; align-self: center !important;\r\n  width: var(--e621x-w, 160px) !important; height: var(--e621x-h, 210px) !important;\r\n  background: var(--color-section, #152f56) !important;\r\n  display: flex !important; flex-direction: column !important;\r\n  position: relative !important; overflow: visible !important;\r\n  z-index: 2; box-sizing: border-box !important;\r\n  transition: transform 0.15s ease, box-shadow 0.15s ease;\r\n}\r\n.e621x-thumb:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0, 0, 0, 0.6); }\r\n.e621x-thumb .thm-link {\r\n  flex: 1 1 auto !important; width: 100% !important; min-height: 0 !important;\r\n  position: relative !important; display: flex !important;\r\n  align-items: center !important; justify-content: center !important; overflow: hidden !important;\r\n}\r\n.e621x-thumb picture { display: flex; width: 100%; height: 100%; align-items: center; justify-content: center; overflow: hidden; }\r\n.e621x-thumb .thm-img-thumb { width: 100%; height: 100%; object-fit: var(--e621x-fit, cover); object-position: center; display: block; }\r\n.e621x-thumb .thm-desc {\r\n  width: 100% !important; max-width: 100% !important; box-sizing: border-box !important;\r\n  margin: 0 !important; align-self: stretch !important; flex-shrink: 0 !important;\r\n  border-radius: 0 0 4px 4px !important;\r\n}\r\n.e621x-pin {\r\n  position: absolute; left: 50%; transform: translateX(-50%);\r\n  width: 18px; height: 18px; border-radius: 50%; box-sizing: border-box;\r\n  background: #152f56; border: 2px solid #3b6aa0; color: #fff;\r\n  font-size: 10px; font-weight: bold; display: flex; align-items: center; justify-content: center;\r\n  z-index: 10; pointer-events: none;\r\n}\r\n.e621x-pin--top { top: -16px; }\r\n.e621x-pin--bottom { bottom: -16px; }\r\n\r\n/* ===== post tree modal ===== */\r\n.e621x-tree-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.75); z-index: 1000000; backdrop-filter: blur(2px); }\r\n.e621x-tree-dialog {\r\n  position: fixed !important; inset: 40px; margin: 0; padding: 0;\r\n  background: var(--color-section, #152f56); border: 1px solid var(--color-section-border, #2a4c7e);\r\n  border-radius: 4px; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.8); z-index: 1000001;\r\n  display: flex; flex-direction: column; overflow: hidden;\r\n}\r\n.e621x-tree-titlebar { display: flex; justify-content: space-between; align-items: center; padding: 8px 16px; border-bottom: 1px solid var(--color-section-border, #2a4c7e); }\r\n.e621x-tree-toolbar { display: flex; gap: 8px; align-items: center; }\r\n.e621x-tree-close { font-size: 20px; line-height: 1; padding: 2px 8px; cursor: pointer; }\r\n.e621x-tree-content { flex: 1; overflow: auto; position: relative; padding: 0; width: 100%; box-sizing: border-box; }\r\n.e621x-tree-message { margin: 40px auto; text-align: center; color: #888; }\r\n.e621x-tree-message--error { color: #ff5555; }\r\n.e621x-tree { position: relative; display: flex; flex-direction: column; align-items: center; width: 100%; min-width: 100%; margin: 0 auto; padding: 30px 24px 0; box-sizing: border-box; }\r\n.e621x-tree-lines { position: absolute; top: 0; left: 0; pointer-events: none; z-index: 1; overflow: visible; }\r\n.e621x-tree-line { stroke: rgba(255, 255, 255, 0.22); stroke-width: 1.5; fill: none; transition: stroke 0.15s ease, stroke-width 0.15s ease, opacity 0.15s ease; }\r\n.e621x-tree-line.is-active { stroke: #3b82f6; stroke-width: 2.5; }\r\n.e621x-tree-line.is-dim { opacity: 0.12; }\r\n.e621x-tree-tier { display: flex; flex-direction: column; align-items: center; width: 100%; max-width: 100%; margin-bottom: 50px; position: relative; z-index: 2; box-sizing: border-box; }\r\n.e621x-tree-divider { display: flex; align-items: center; width: 100%; margin-bottom: 24px; user-select: none; }\r\n.e621x-tree-divider-line { flex: 1; height: 1px; background: rgba(255, 255, 255, 0.08); }\r\n.e621x-tree-divider-label { padding: 2px 14px; margin: 0 16px; font-size: 10px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; color: #8a9ba8; background: #0c1a2f; border: 1px solid #24416b; border-radius: 12px; }\r\n.e621x-tree-cards { display: flex; flex-flow: row wrap; justify-content: center; align-items: flex-start; gap: 36px 24px; width: 100%; max-width: 100%; box-sizing: border-box; }\r\n.e621x-tree-spacer { width: 100%; height: 60px; flex-shrink: 0; pointer-events: none; }\r\n\r\n/* ===== \"show post tree\" button / notices ===== */\r\n.e621x-notice-row { display: flex !important; align-items: center !important; flex-wrap: wrap !important; gap: 8px !important; }\r\n.e621x-notice-inline { display: inline-flex !important; align-items: center !important; gap: 6px !important; min-height: 32px !important; line-height: normal !important; margin: 0 !important; vertical-align: middle !important; }\r\n.e621x-tree-btn { margin-left: 8px; vertical-align: middle; }\r\n\r\n/* ===== tag script panel ===== */\r\n#e621x-tag-script-ui { display: none; margin-top: 0.5em; flex-direction: column; gap: 6px; }\r\n#e621x-tag-script-ui.is-visible { display: flex; }\r\n.e621x-ts-input { width: 100%; min-width: 0; box-sizing: border-box; font-size: 12px; padding: 4px 6px; }\r\n.e621x-ts-grow { flex: 1 1 0; min-width: 0; width: auto; }\r\n.e621x-ts-all { padding: 4px 10px; font-size: 12px; cursor: pointer; flex-shrink: 0; }\r\n.e621x-ts-btn { padding: 4px 6px; font-size: 12px; cursor: pointer; white-space: nowrap; flex-shrink: 0; }\r\n.e621x-ts-row { display: flex; gap: 4px; align-items: center; width: 100%; box-sizing: border-box; }\r\n.e621x-ts-row--spread { justify-content: space-between; padding: 0px 0; font-size: 11px; }\r\n.e621x-ts-label { display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; color: #b4c7d9; }\r\n\r\n/* ===== Hover Zoom ===== */\r\n.e621x-zoom {\r\n  position: fixed;\r\n  z-index: 10000002;\r\n  pointer-events: none;\r\n  padding: 0 !important;\r\n  margin: 0 !important;\r\n  line-height: 0 !important;\r\n  font-size: 0 !important;\r\n  border: 1px solid rgba(255, 255, 255, 0.45);\r\n  background: transparent !important;\r\n  border-radius: 4px;\r\n  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.9);\r\n  overflow: hidden;\r\n  box-sizing: content-box !important;\r\n  display: block;\r\n}\r\n\r\n.e621x-zoom.is-hidden {\r\n  display: none !important;\r\n}\r\n\r\n.e621x-zoom-media {\r\n  display: block !important;\r\n  margin: 0 !important;\r\n  padding: 0 !important;\r\n  border: none !important;\r\n  outline: none !important;\r\n}\r\n\r\n/* ===== Queued Tag Scripts (3px Clean Yellow Outline outside thumbnail) ===== */\r\n.e621x-thumb-queued {\r\n  outline: 3px solid #ffff00 !important;\r\n  outline-offset: 0 !important;\r\n  box-shadow: none !important;\r\n  position: relative !important;\r\n  z-index: 5 !important;\r\n}\r\n\r\n/* ===== Successfully Updated Tag Scripts (3px Clean Green Outline) ===== */\r\n.e621x-thumb-updated {\r\n  outline: 3px solid #22c55e !important;\r\n  outline-offset: 0 !important;\r\n  box-shadow: none !important;\r\n  position: relative !important;\r\n  z-index: 5 !important;\r\n}\r\n\r\n/* ===== Locked Tag Scripts (3px Clean Red Outline) ===== */\r\n.e621x-thumb-locked {\r\n  outline: 3px solid #ef4444 !important;\r\n  outline-offset: 0 !important;\r\n  box-shadow: none !important;\r\n  position: relative !important;\r\n  z-index: 5 !important;\r\n}\r\n\r\n\r\n.e621x-ts-queue-link {\r\n  font-size: 11px;\r\n  color: #ffff00 !important;\r\n  font-weight: bold;\r\n  text-decoration: underline;\r\n  margin-left: auto;\r\n  margin-right: 8px;\r\n}\r\n.e621x-ts-queue-link:hover {\r\n  color: #ffffff !important;\r\n}\r\n\r\n/* ===== /posts/timeouted page ===== */\r\n.e621x-queue-page {\r\n  width: 100%;\r\n  max-width: 1600px;\r\n  margin: 20px auto;\r\n  padding: 0 20px 60px;\r\n  box-sizing: border-box;\r\n}\r\n\r\n.e621x-queue-header {\r\n  background: var(--color-section, #152f56);\r\n  border: 1px solid var(--color-section-border, #2a4c7e);\r\n  border-radius: 4px;\r\n  padding: 16px 20px;\r\n  margin-bottom: 24px;\r\n  display: flex;\r\n  flex-wrap: wrap;\r\n  justify-content: space-between;\r\n  align-items: center;\r\n  gap: 16px;\r\n}\r\n\r\n.e621x-queue-title-area h2 {\r\n  margin: 0 0 4px 0;\r\n  font-size: 18px;\r\n  color: #ffffff;\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 10px;\r\n}\r\n\r\n.e621x-queue-badge {\r\n  background: #ffff00;\r\n  color: #000000;\r\n  font-size: 11px;\r\n  font-weight: 700;\r\n  padding: 2px 8px;\r\n  border-radius: 10px;\r\n}\r\n\r\n.e621x-queue-subtitle {\r\n  font-size: 12px;\r\n  color: #b4c7d9;\r\n}\r\n\r\n.e621x-queue-actions {\r\n  display: flex;\r\n  gap: 10px;\r\n  align-items: center;\r\n}\r\n\r\n.e621x-queue-status-pill {\r\n  font-size: 12px;\r\n  padding: 6px 12px;\r\n  background: #0a1b32;\r\n  border: 1px solid #24416b;\r\n  border-radius: 4px;\r\n  color: #e2e8f0;\r\n}\r\n.e621x-queue-status-pill.is-timeout {\r\n  border-color: #eab308;\r\n  color: #fef08a;\r\n}\r\n.e621x-queue-status-pill.is-ready {\r\n  border-color: #22c55e;\r\n  color: #86efac;\r\n}\r\n\r\n.e621x-queue-card-wrap {\r\n  position: relative;\r\n  display: flex;\r\n  flex-direction: column;\r\n  align-items: center;\r\n  gap: 6px;\r\n}\r\n\r\n.e621x-queue-card-meta {\r\n  width: var(--e621x-w, 160px);\r\n  background: #0a1b32;\r\n  border: 1px solid #24416b;\r\n  border-radius: 4px;\r\n  padding: 6px 8px;\r\n  box-sizing: border-box;\r\n  font-size: 11px;\r\n  color: #ffffff;\r\n  display: flex;\r\n  flex-direction: column;\r\n  gap: 4px;\r\n}\r\n\r\n.e621x-queue-diff {\r\n  word-break: break-all;\r\n  font-family: monospace;\r\n  font-size: 10px;\r\n  color: #fef08a;\r\n  max-height: 48px;\r\n  overflow-y: auto;\r\n}\r\n\r\n.e621x-queue-card-actions {\r\n  display: flex;\r\n  justify-content: space-between;\r\n  align-items: center;\r\n  margin-top: 2px;\r\n}\r\n\r\n.e621x-queue-remove-btn {\r\n  background: transparent;\r\n  border: 1px solid #ef4444;\r\n  color: #ef4444;\r\n  font-size: 10px;\r\n  padding: 2px 6px;\r\n  border-radius: 2px;\r\n  cursor: pointer;\r\n  transition: all 0.15s;\r\n}\r\n.e621x-queue-remove-btn:hover {\r\n  background: #ef4444;\r\n  color: #ffffff;\r\n}\r\n\r\n.e621x-queue-empty {\r\n  text-align: center;\r\n  padding: 60px 20px;\r\n  background: var(--color-section, #152f56);\r\n  border: 1px solid var(--color-section-border, #2a4c7e);\r\n  border-radius: 4px;\r\n  color: #b4c7d9;\r\n}\r\n.e621x-queue-empty h3 {\r\n  color: #ffffff;\r\n  margin-bottom: 8px;\r\n}\r\n\r\n.hidden {\r\n  display: none !important;\r\n}\r\n\r\n/* ===== Tag Script Ctrl Preview Tooltip ===== */\r\n.e621x-ts-preview {\r\n  position: fixed;\r\n  z-index: 10000005;\r\n  pointer-events: none;\r\n  background: #000000;\r\n  border: 1px solid #ffffff;\r\n  border-radius: 2px;\r\n  padding: 8px 12px;\r\n  color: #ffffff;\r\n  font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif;\r\n  font-size: 13px;\r\n  line-height: 1.5;\r\n  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.85);\r\n  white-space: nowrap;\r\n  display: flex;\r\n  flex-direction: column;\r\n  gap: 2px;\r\n}\r\n\r\n.e621x-ts-preview.is-hidden {\r\n  display: none !important;\r\n}\r\n\r\n.e621x-ts-preview-line {\r\n  display: block;\r\n}\r\n\r\n.e621x-ts-preview-bullet {\r\n  color: #ffffff;\r\n  margin-right: 6px;\r\n  user-select: none;\r\n}\r\n\r\n/* Tag type colors matching e621 categories */\r\n.e621x-tag-type-0, .e621x-tag-type-general { color: #7eb3e6; }\r\n.e621x-tag-type-1, .e621x-tag-type-artist { color: #f2ac08; }\r\n.e621x-tag-type-2, .e621x-tag-type-contributor { color: #00aa00; }\r\n.e621x-tag-type-3, .e621x-tag-type-copyright { color: #dd00aa; }\r\n.e621x-tag-type-4, .e621x-tag-type-character { color: #00aa00; }\r\n.e621x-tag-type-5, .e621x-tag-type-species { color: #ed5d1f; }\r\n.e621x-tag-type-6, .e621x-tag-type-invalid { color: #ff3333; }\r\n.e621x-tag-type-7, .e621x-tag-type-meta { color: #ffffff; }\r\n.e621x-tag-type-8, .e621x-tag-type-lore { color: #2e8b57; }\r\n.e621x-tag-type-command { color: #fef08a; }\r\n.e621x-tag-type-prefix { color: #94a3b8; }\r\n\r\n/* ===== Specific Post Edits Filter ===== */\r\n.e621x-specific-edits-wrapper {\r\n  margin-top: 10px;\r\n  width: 100%;\r\n  display: flex;\r\n  flex-direction: column;\r\n  align-items: center;\r\n  text-align: center;\r\n}\r\n\r\n.e621x-specific-edits-trigger {\r\n  font-size: 11px;\r\n  color: #ffff00 !important;\r\n  font-weight: bold;\r\n  text-decoration: underline;\r\n  cursor: pointer;\r\n  display: inline-block;\r\n  text-align: center;\r\n  margin: 6px auto;\r\n  user-select: none;\r\n  transition: color 0.15s ease;\r\n}\r\n\r\n.e621x-specific-edits-trigger:hover {\r\n  color: #ffffff !important;\r\n}\r\n\r\n.e621x-specific-edits-panel {\r\n  background: var(--color-section, #152f56);\r\n  border: 1px solid var(--color-section-border, #2a4c7e);\r\n  border-radius: 4px;\r\n  padding: 12px 14px;\r\n  margin: 8px auto 0 auto;\r\n  width: 100%;\r\n  max-width: 480px;\r\n  box-sizing: border-box;\r\n  display: flex;\r\n  flex-direction: column;\r\n  gap: 10px;\r\n  font-size: 12px;\r\n  text-align: left;\r\n}\r\n\r\n.e621x-specific-edits-panel.is-hidden {\r\n  display: none !important;\r\n}\r\n\r\n.e621x-specific-edits-header {\r\n  display: flex;\r\n  justify-content: space-between;\r\n  align-items: center;\r\n  border-bottom: 1px solid rgba(255, 255, 255, 0.12);\r\n  padding-bottom: 6px;\r\n}\r\n\r\n.e621x-specific-edits-title {\r\n  font-weight: bold;\r\n  color: #ffffff;\r\n  font-size: 12px;\r\n  letter-spacing: 0.3px;\r\n}\r\n\r\n.e621x-specific-edits-close {\r\n  background: transparent;\r\n  border: none;\r\n  color: #8a9ba8;\r\n  font-size: 16px;\r\n  line-height: 1;\r\n  cursor: pointer;\r\n  padding: 0 4px;\r\n}\r\n\r\n.e621x-specific-edits-close:hover {\r\n  color: #ffffff;\r\n}\r\n\r\n.e621x-specific-edits-fields {\r\n  display: flex;\r\n  flex-direction: column;\r\n  gap: 8px;\r\n}\r\n\r\n.e621x-specific-edits-field {\r\n  display: flex;\r\n  flex-direction: column;\r\n  gap: 3px;\r\n}\r\n\r\n.e621x-specific-edits-field label {\r\n  font-size: 11px;\r\n  color: #b4c7d9;\r\n  font-weight: 600;\r\n}\r\n\r\n.e621x-specific-edits-input {\r\n  width: 100%;\r\n  box-sizing: border-box;\r\n  font-size: 12px;\r\n  padding: 6px 8px;\r\n  background-color: #ffffff !important;\r\n  color: #000000 !important;\r\n  border: 1px solid #cccccc;\r\n  border-radius: 2px;\r\n  outline: none;\r\n  transition: background-color 0.15s ease, border-color 0.15s ease;\r\n}\r\n\r\n.e621x-specific-edits-input::placeholder {\r\n  color: #777777 !important;\r\n}\r\n\r\n.e621x-specific-edits-input:focus {\r\n  background-color: #ffffcc !important;\r\n  border-color: #bbbb33 !important;\r\n  color: #000000 !important;\r\n}\r\n\r\n.e621x-specific-edits-actions {\r\n  display: flex;\r\n  gap: 6px;\r\n  align-items: center;\r\n  flex-wrap: wrap;\r\n  margin-top: 4px;\r\n}\r\n\r\n.e621x-specific-edits-btn {\r\n  padding: 4px 12px;\r\n  font-size: 11px;\r\n  cursor: pointer;\r\n  white-space: nowrap;\r\n}\r\n\r\n.e621x-specific-edits-status {\r\n  font-size: 11px;\r\n  color: #fef08a;\r\n  background: #0a1b32;\r\n  border: 1px solid #24416b;\r\n  border-radius: 3px;\r\n  padding: 6px 10px;\r\n  line-height: 1.4;\r\n  word-break: break-word;\r\n}\r\n\r\n.e621x-specific-edits-status.is-error {\r\n  color: #ff6b6b;\r\n  border-color: #7f1d1d;\r\n}\r\n\r\n.e621x-specific-edits-status a {\r\n  color: #ffff00;\r\n  text-decoration: underline;\r\n  margin-left: 4px;\r\n  font-weight: 600;\r\n}\r\n\r\n/* ===== Tag Update Statistics Modal & Table ===== */\r\n.e621x-specific-edits-triggers-row {\r\n  display: flex;\r\n  gap: 10px;\r\n  align-items: center;\r\n  justify-content: center;\r\n  margin: 6px auto;\r\n}\r\n\r\n.e621x-trigger-sep {\r\n  color: #64748b;\r\n  font-size: 13px;\r\n  user-select: none;\r\n}\r\n\r\n.e621x-stats-overlay {\r\n  position: fixed;\r\n  inset: 0;\r\n  background: rgba(0, 0, 0, 0.8);\r\n  z-index: 1000000;\r\n  backdrop-filter: blur(3px);\r\n  display: flex;\r\n  align-items: center;\r\n  justify-content: center;\r\n}\r\n\r\n.e621x-stats-dialog {\r\n  width: 92%;\r\n  max-width: 1050px;\r\n  height: 85vh;\r\n  background: var(--color-section, #152f56);\r\n  border: 1px solid var(--color-section-border, #2a4c7e);\r\n  border-radius: 6px;\r\n  box-shadow: 0 14px 45px rgba(0, 0, 0, 0.85);\r\n  display: flex;\r\n  flex-direction: column;\r\n  overflow: hidden;\r\n  box-sizing: border-box;\r\n}\r\n\r\n.e621x-stats-header {\r\n  display: flex;\r\n  justify-content: space-between;\r\n  align-items: center;\r\n  padding: 12px 18px;\r\n  background: #0a1b32;\r\n  border-bottom: 1px solid var(--color-section-border, #2a4c7e);\r\n}\r\n\r\n.e621x-stats-title {\r\n  font-size: 15px;\r\n  font-weight: 700;\r\n  color: #ffffff;\r\n  letter-spacing: 0.4px;\r\n}\r\n\r\n.e621x-stats-close-btn {\r\n  background: transparent;\r\n  border: none;\r\n  color: #94a3b8;\r\n  font-size: 24px;\r\n  line-height: 1;\r\n  cursor: pointer;\r\n  padding: 0 4px;\r\n  transition: color 0.15s;\r\n}\r\n\r\n.e621x-stats-close-btn:hover {\r\n  color: #ffffff;\r\n}\r\n\r\n/* Progress Box */\r\n.e621x-stats-progress-box {\r\n  padding: 30px 24px;\r\n  display: flex;\r\n  flex-direction: column;\r\n  align-items: center;\r\n  gap: 16px;\r\n  background: rgba(10, 27, 50, 0.5);\r\n}\r\n\r\n.e621x-stats-progress-text {\r\n  font-size: 14px;\r\n  color: #fef08a;\r\n  font-weight: 600;\r\n  text-align: center;\r\n}\r\n\r\n.e621x-stats-progress-track {\r\n  width: 100%;\r\n  max-width: 500px;\r\n  height: 8px;\r\n  background: #0a1b32;\r\n  border: 1px solid #24416b;\r\n  border-radius: 4px;\r\n  overflow: hidden;\r\n}\r\n\r\n.e621x-stats-progress-fill {\r\n  height: 100%;\r\n  width: 0%;\r\n  background: #3b82f6;\r\n  transition: width 0.25s ease;\r\n}\r\n\r\n.e621x-stats-progress-actions {\r\n  display: flex;\r\n  gap: 12px;\r\n}\r\n\r\n/* Summary Bar */\r\n.e621x-stats-summary-bar {\r\n  display: grid;\r\n  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));\r\n  gap: 10px;\r\n  padding: 12px 18px;\r\n  background: #0e223d;\r\n  border-bottom: 1px solid var(--color-section-border, #2a4c7e);\r\n}\r\n\r\n.e621x-stats-summary-card {\r\n  display: flex;\r\n  flex-direction: column;\r\n  align-items: center;\r\n  justify-content: center;\r\n  background: #0a1b32;\r\n  border: 1px solid #24416b;\r\n  border-radius: 4px;\r\n  padding: 8px 10px;\r\n  text-align: center;\r\n}\r\n\r\n.e621x-stats-summary-num {\r\n  font-size: 18px;\r\n  font-weight: 700;\r\n  color: #ffffff;\r\n}\r\n\r\n.e621x-stats-summary-lbl {\r\n  font-size: 10px;\r\n  text-transform: uppercase;\r\n  color: #94a3b8;\r\n  letter-spacing: 0.8px;\r\n  margin-top: 2px;\r\n}\r\n\r\n.e621x-color-add {\r\n  color: #22c55e !important;\r\n}\r\n\r\n.e621x-color-rem {\r\n  color: #ef4444 !important;\r\n}\r\n\r\n/* Toolbar */\r\n.e621x-stats-toolbar {\r\n  display: flex;\r\n  flex-wrap: wrap;\r\n  justify-content: space-between;\r\n  align-items: center;\r\n  gap: 10px;\r\n  padding: 10px 18px;\r\n  background: #0c1c30;\r\n  border-bottom: 1px solid #24416b;\r\n}\r\n\r\n.e621x-stats-toolbar-group {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 8px;\r\n  flex-wrap: wrap;\r\n}\r\n\r\n.e621x-stats-search {\r\n  width: 190px;\r\n  background: #ffffff !important;\r\n  color: #000000 !important;\r\n  padding: 5px 8px;\r\n  font-size: 12px;\r\n  border-radius: 2px;\r\n}\r\n\r\n.e621x-stats-select {\r\n  padding: 5px 8px;\r\n  font-size: 12px;\r\n  background: #0a1b32;\r\n  color: #ffffff;\r\n  border: 1px solid #24416b;\r\n  border-radius: 2px;\r\n  outline: none;\r\n  cursor: pointer;\r\n}\r\n\r\n.e621x-stats-btn {\r\n  padding: 5px 12px;\r\n  font-size: 11px;\r\n  cursor: pointer;\r\n  white-space: nowrap;\r\n}\r\n\r\n/* Table Area */\r\n.e621x-stats-table-wrap {\r\n  flex: 1;\r\n  overflow-y: auto;\r\n  padding: 0;\r\n  background: #0a1728;\r\n}\r\n\r\n.e621x-stats-table {\r\n  width: 100%;\r\n  border-collapse: collapse;\r\n  font-size: 12px;\r\n  text-align: left;\r\n}\r\n\r\n.e621x-stats-table th {\r\n  position: sticky;\r\n  top: 0;\r\n  background: #0a1b32;\r\n  color: #94a3b8;\r\n  font-size: 11px;\r\n  text-transform: uppercase;\r\n  letter-spacing: 0.6px;\r\n  padding: 9px 14px;\r\n  border-bottom: 1px solid #24416b;\r\n  z-index: 2;\r\n}\r\n\r\n.e621x-stats-table td {\r\n  padding: 7px 14px;\r\n  border-bottom: 1px solid rgba(255, 255, 255, 0.05);\r\n  color: #e2e8f0;\r\n}\r\n\r\n.e621x-stats-row:hover {\r\n  background: rgba(255, 255, 255, 0.04);\r\n}\r\n\r\n.e621x-stats-tag-link {\r\n  font-weight: 600;\r\n  text-decoration: none;\r\n  display: inline-block;\r\n  transition: opacity 0.15s;\r\n}\r\n\r\n.e621x-stats-tag-link:hover {\r\n  text-decoration: underline;\r\n  opacity: 0.85;\r\n}\r\n\r\n.e621x-cat-badge {\r\n  display: inline-block;\r\n  font-size: 9px;\r\n  font-weight: 700;\r\n  text-transform: uppercase;\r\n  letter-spacing: 0.6px;\r\n  padding: 1px 6px;\r\n  border-radius: 10px;\r\n  border: 1px solid currentColor;\r\n  background: rgba(0, 0, 0, 0.3);\r\n}\r\n\r\n.e621x-stats-count-link {\r\n  font-weight: 700;\r\n  text-decoration: none;\r\n  cursor: pointer;\r\n}\r\n\r\n.e621x-stats-count-link:hover {\r\n  text-decoration: underline;\r\n}\r\n\r\n.e621x-stats-count-zero {\r\n  color: #64748b;\r\n}\r\n\r\n.e621x-stats-date {\r\n  color: #94a3b8;\r\n  font-family: monospace;\r\n  font-size: 11px;\r\n}\r\n\r\n.e621x-stats-empty {\r\n  text-align: center;\r\n  padding: 40px 10px;\r\n  color: #94a3b8;\r\n  font-size: 13px;\r\n}\r\n\r\n/* Pagination Bar */\r\n.e621x-stats-pagination {\r\n  display: flex;\r\n  justify-content: space-between;\r\n  align-items: center;\r\n  padding: 8px 18px;\r\n  background: #0a1b32;\r\n  border-top: 1px solid #24416b;\r\n}\r\n\r\n.e621x-stats-page-info {\r\n  font-size: 11px;\r\n  color: #94a3b8;\r\n}\r\n\r\n.e621x-stats-pagination-buttons {\r\n  display: flex;\r\n  gap: 8px;\r\n}\r\n\r\n.hidden,\r\n.e621x-stats-progress-box.hidden {\r\n  display: none !important;\r\n}\r\n"};
	
	const LOCALE_KEYS = {};
	const USED_LOCALE = "en";
	const CURRENT_LOCATION = window.location.href;
	
	const convertMatchPatternToRegExp = function convertMatchPatternToRegExp(pattern) {
	  if (pattern === "<all_urls>") {
	    return new RegExp(".*");
	  }
	  try {
	    const singleEscapedPattern = convertMatchPatternToRegExpString(
	      pattern
	    ).replace(/\\\\/g, "\\");
	    return new RegExp(singleEscapedPattern);
	  } catch (error) {
	    debug(
	      "Error converting match pattern to RegExp: %s, Error: %s",
	      pattern,
	      error.message
	    );
	    return new RegExp("$."); // Matches nothing on error
	  }
	};
	const convertMatchPatternToRegExpString = function convertMatchPatternToRegExpString(pattern) {
	  function escapeRegex(s) {
	    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\\\$&");
	  }
	
	  if (typeof pattern !== "string" || !pattern) {
	    return "$."; // Matches nothing
	  }
	
	  const schemeMatch = pattern.match(/^(\*|https?|file|ftp):\/\//);
	  if (!schemeMatch) return "$."; // Invalid pattern
	  const scheme = schemeMatch[1];
	  pattern = pattern.substring(schemeMatch[0].length);
	  const schemeRegex = scheme === "*" ? "https?|file|ftp" : scheme;
	
	  const hostMatch = pattern.match(/^([^\/]+)/);
	  if (!hostMatch) return "$."; // Invalid pattern
	  const host = hostMatch[1];
	  pattern = pattern.substring(host.length); // Remainder is path
	
	  let hostRegex;
	  if (host === "*") {
	    hostRegex = "[^/]+"; // Matches any sequence of non-slash characters
	  } else if (host.startsWith("*.")) {
	    // Match any subdomain or the main domain
	    hostRegex = "(?:[^\\/]+\\.)?" + escapeRegex(host.substring(2));
	  } else {
	    hostRegex = escapeRegex(host); // Exact host match
	  }
	
	  let pathRegex = pattern;
	  if (!pathRegex.startsWith("/")) {
	    pathRegex = "/" + pathRegex; // Ensure path starts with /
	  }
	  // Convert glob (*) to regex (.*) and escape other special chars
	  pathRegex = pathRegex.split("*").map(escapeRegex).join(".*");
	
	  // Ensure the pattern covers the entire path segment correctly
	  if (pathRegex === "/.*") {
	    // Equivalent to /* in manifest, matches the root and anything after
	    pathRegex = "(?:/.*)?";
	  } else {
	    // Match the specific path and optionally query/hash or end of string
	    pathRegex = pathRegex + "(?:[?#]|$)";
	  }
	
	  // Combine and return the pattern string
	  // Needs double escaping for direct embedding in generated JS strings
	  const finalRegexString = `^${schemeRegex}:\\/\\/${hostRegex}${pathRegex}`;
	  return finalRegexString;
	};
	const ALL_PERMISSIONS = [
	  ...(INJECTED_MANIFEST.permissions || []),
	  ...(INJECTED_MANIFEST.optional_permissions || []),
	  ...(INJECTED_MANIFEST.host_permissions || []),
	  ...(INJECTED_MANIFEST.content_scripts
	    ?.map((cs) => cs.matches || [])
	    ?.flat() || []),
	];
	
	const isOrigin = (perm) => {
	  if (
	    perm.startsWith("*://") ||
	    perm.startsWith("http://") ||
	    perm.startsWith("https://")
	  ) {
	    return true;
	  }
	  return false;
	};
	const ORIGIN_PERMISSIONS = ALL_PERMISSIONS.filter(isOrigin);
	const EXTENSION_PERMISSIONS = ALL_PERMISSIONS.filter((perm) => !isOrigin(perm));
	
	function _testBlobCSP() {
	  try {
	    const code = `console.log("Blob CSP test");`;
	    const blob = new Blob([code], { type: "application/javascript" });
	    const blobUrl = URL.createObjectURL(blob);
	
	    const script = document.createElement("script");
	    script.src = blobUrl;
	
	    let blocked = false;
	    script.onerror = () => {
	      blocked = true;
	    };
	
	    document.head.appendChild(script);
	
	    return new Promise((resolve) => {
	      setTimeout(() => {
	        resolve(!blocked);
	        document.head.removeChild(script);
	        URL.revokeObjectURL(blobUrl);
	      }, 100);
	    });
	  } catch (e) {
	    return Promise.resolve(false);
	  }
	}
	
	let CAN_USE_BLOB_CSP = false;
	
	const waitForDOMEnd = () => {
	  if (document.readyState === "loading") {
	    return new Promise((resolve) =>
	      document.addEventListener("DOMContentLoaded", resolve, { once: true })
	    );
	  }
	  return Promise.resolve();
	};
	
	waitForDOMEnd().then(() => {
	  _testBlobCSP().then((result) => {
	    CAN_USE_BLOB_CSP = result;
	  });
	});
	
	function _base64ToBlob(base64, mimeType = "application/octet-stream") {
	  const binary = atob(base64);
	  const len = binary.length;
	  const bytes = new Uint8Array(len);
	  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
	  return new Blob([bytes], { type: mimeType });
	}
	
	function _getMimeTypeFromPath(p) {
	  const ext = (p.split(".").pop() || "").toLowerCase();
	  const map = {
	    html: "text/html",
	    htm: "text/html",
	    js: "text/javascript",
	    css: "text/css",
	    json: "application/json",
	    png: "image/png",
	    jpg: "image/jpeg",
	    jpeg: "image/jpeg",
	    gif: "image/gif",
	    svg: "image/svg+xml",
	    webp: "image/webp",
	    ico: "image/x-icon",
	    woff: "font/woff",
	    woff2: "font/woff2",
	    ttf: "font/ttf",
	    otf: "font/otf",
	    eot: "application/vnd.ms-fontobject",
	  };
	  return map[ext] || "application/octet-stream";
	}
	
	function _isTextAsset(ext) {
	  return ["html", "htm", "js", "css", "json", "svg", "txt", "xml"].includes(
	    ext
	  );
	}
	
	function _createAssetUrl(path = "") {
	  if (path.startsWith("/")) path = path.slice(1);
	  const assetData = EXTENSION_ASSETS_MAP[path];
	  if (typeof assetData === "undefined") {
	    _warn("[runtime.getURL] Asset not found for", path);
	    return path;
	  }
	
	  const mime = _getMimeTypeFromPath(path);
	  const ext = (path.split(".").pop() || "").toLowerCase();
	
	  if (CAN_USE_BLOB_CSP) {
	    let blob;
	    if (_isTextAsset(ext)) {
	      blob = new Blob([assetData], { type: mime });
	    } else {
	      blob = _base64ToBlob(assetData, mime);
	    }
	
	    return URL.createObjectURL(blob);
	  } else {
	    if (_isTextAsset(ext)) {
	      return `data:${mime};base64,${btoa(assetData)}`;
	    } else {
	      return `data:${mime};base64,${assetData}`;
	    }
	  }
	}
	
	function _matchGlobPattern(pattern, path) {
	  if (!pattern || !path) return false;
	
	  pattern = pattern.replace(/\\/g, "/");
	  path = path.replace(/\\/g, "/");
	
	  if (pattern === path) return true;
	
	  let regexPattern = pattern
	    .replace(/[.+?^${}()|[\]\\]/g, "\\$&") // Escape regex chars
	    .replace(/\*\*/g, "__DOUBLESTAR__") // Temporarily replace **
	    .replace(/\*/g, "[^/]*") // * matches any chars except /
	    .replace(/__DOUBLESTAR__/g, ".*"); // ** matches any chars including /
	
	  regexPattern = "^" + regexPattern + "$";
	
	  try {
	    const regex = new RegExp(regexPattern);
	    return regex.test(path);
	  } catch (e) {
	    _error(`Invalid glob pattern: ${pattern}`, e);
	    return false;
	  }
	}
	
	function _isWebAccessibleResource(resourcePath, webAccessibleResources) {
	  if (
	    !Array.isArray(webAccessibleResources) ||
	    webAccessibleResources.length === 0
	  ) {
	    return false;
	  }
	
	  // Normalize the resource path
	  const normalizedPath = resourcePath.replace(/\\/g, "/").replace(/^\/+/, "");
	
	  for (const webAccessibleResource of webAccessibleResources) {
	    let patterns = [];
	
	    // Handle both manifest v2 and v3 formats
	    if (typeof webAccessibleResource === "string") {
	      // Manifest v2 format: array of strings
	      patterns = [webAccessibleResource];
	    } else if (
	      webAccessibleResource &&
	      Array.isArray(webAccessibleResource.resources)
	    ) {
	      // Manifest v3 format: objects with resources array
	      patterns = webAccessibleResource.resources;
	    }
	
	    // Check if the path matches any pattern
	    for (const pattern of patterns) {
	      if (_matchGlobPattern(pattern, normalizedPath)) {
	        return true;
	      }
	    }
	  }
	
	  return false;
	}
	
	window._matchGlobPattern = _matchGlobPattern;
	window._isWebAccessibleResource = _isWebAccessibleResource;
	
	// This function contains all the CSS injection and JS execution,
	// ordered by run_at timing internally using await.
	
  // #region Script Execution Logic
		async function executeAllScripts(globalThis, extensionCssData) {
		  const {chrome, browser, global, window, self} = globalThis;
		  const scriptName = "e621 extras";
		  _log(`Starting execution phases...`);
		
  // #region Document Start
			  if (typeof document !== 'undefined') {
			    _log(`Executing document-start phase...`);
			    
			    const scriptPaths = [];
			   _log(`  Executing JS (start): ${scriptPaths}`);
			
			   try {
			       // Keep variables from being redeclared for global scope, but also make them apply to global scope. (Theoretically)
			      with (globalThis){;
			
			;}
			   } catch(e) { _error(`  Error executing scripts ${scriptPaths}`, e); }
			  
			  } else {
			      _log(`Skipping document-start phase (no document).`);
			  }
			
			  
  // #endregion
  // #region Wait for Document End DOMContentLoaded ---
			  if (typeof document !== 'undefined' && document.readyState === 'loading') {
			    _log(`Waiting for DOMContentLoaded...`);
			    await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
			    _log(`DOMContentLoaded fired.`);
			  } else if (typeof document !== 'undefined') {
			    _log(`DOMContentLoaded already passed or not applicable.`);
			  }
			  
			
  // #endregion
  // #region Document End
			   if (typeof document !== 'undefined') {
			    _log(`Executing document-end phase...`);
			    
			        const cssKey_0 = "styles/extras.css";
			    try {
			      if (extensionCssData[cssKey_0]) {
			        _log(`  Injecting CSS (end): ${cssKey_0}`);
			        const style = document.createElement('style');
			        style.textContent = extensionCssData[cssKey_0];
			        (document.head || document.documentElement).appendChild(style);
			      } else { console.warn(`  CSS not found (end): ${cssKey_0}`); }
			    } catch(e) { _error(`  Failed injecting CSS (${cssKey_0}) in phase end`, e, extensionCssData); }
			  
			    const scriptPaths = ["scripts/constants.js","scripts/core.js","scripts/selectors.js","scripts/utils.js","scripts/net.js","scripts/ui/dom.js","scripts/ui/layout.js","scripts/ui/thumbnail.js","scripts/ui/dtext.js","scripts/ui/tooltips.js","scripts/blacklist.js","scripts/uploader.js","scripts/user_edits.js","scripts/tree/data.js","scripts/tree/export.js","scripts/tree/modal.js","scripts/hover_zoom/data.js","scripts/hover_zoom/index.js","scripts/tag_script/engine.js","scripts/tag_script/queue.js","scripts/tag_script/timeouted_page.js","scripts/tag_script/logger.js","scripts/tag_script/storage.js","scripts/tag_script/runner.js","scripts/tag_script/preview.js","scripts/tag_script/index.js","scripts/content.js"];
			   _log(`  Executing JS (end): ${scriptPaths}`);
			
			   try {
			       // Keep variables from being redeclared for global scope, but also make them apply to global scope. (Theoretically)
			      with (globalThis){;
			// START: scripts/constants.js
			/* Shared by content scripts, popup and background — single source of truth for keys and message names. */
			globalThis.E621_CONSTANTS = Object.freeze({
			  SCHEMA_VERSION: 1,
			
			  STORAGE_KEYS: Object.freeze({
			    SCHEMA_VERSION: 'e621_schema_version',
			    DOWNVOTES: 'e621_downvoted_posts',
			    BLACKLIST_BACKUP: 'e621_clean_blacklist_backup',
			    BLACKLIST_LOCKED: 'e621_load_blacklist_disabled',
			    AUTO_UPDATE: 'e621_auto_update_enabled',
			    SHOW_UPLOADER: 'e621_extra_show_uploader',
			    ACTIVE_POPUP_TAB: 'e621_active_popup_tab',
			
			    /* Hover Zoom keys */
			    HZ_ENABLED: 'e621_hz_enabled',
			    HZ_LOAD_SAMPLE: 'e621_hz_load_sample',
			    HZ_TAGS: 'e621_hz_tags',
			    HZ_TIME: 'e621_hz_time',
			    HZ_AUDIO: 'e621_hz_audio',
			    HZ_DELAY: 'e621_hz_delay',
			    HZ_STICKY: 'e621_hz_sticky',
			
			    /* Queued / Timeouted Tag Scripts keys */
			    QUEUE_TAG_SCRIPTS_ENABLED: 'e621_queue_tag_scripts_enabled',
			    TAG_SCRIPT_QUEUE: 'e621_tag_script_queue',
			    QUEUE_TIMEOUT_UNTIL: 'e621_queue_timeout_until',
			    QUEUE_SLOT_TIMESTAMPS: 'e621_queue_slot_timestamps',
			
			    /* Preview & Tooltip suppression & Performance */
			    CTRL_PREVIEW_ENABLED: 'e621_ctrl_preview_enabled',
			    CTRL_PREVIEW_STICKY: 'e621_ctrl_preview_sticky',
			    CTRL_STICKY_ACTIVE: 'e621_ctrl_sticky_active',
			    HIDE_THUMB_TOOLTIPS: 'e621_hide_thumb_tooltips',
			    TRACKING_FPS: 'e621_tracking_fps'
			  }),
			
			  ACTIONS: Object.freeze({
			    BACKUP_BLACKLIST: 'backupBlacklist',
			    LOAD_DOWNVOTES: 'loadDownvotes',
			    UPLOAD_DOWNVOTES: 'uploadDownvotes',
			    UNLOAD_DOWNVOTES: 'unloadDownvotes',
			    SYNC_API: 'syncApi',
			    TOGGLE_AUTO_UPDATE: 'toggleAutoUpdate',
			    SHOW_POST_TREE: 'showPostTree',
			    FETCH_IMAGE: 'fetchImageAsDataUrl',
			    PROCESS_TAG_QUEUE: 'processTagQueue',
			    CLEAR_TAG_QUEUE: 'clearTagQueue',
			    ENQUEUE_TAG_SCRIPT: 'enqueueTagScript',
			    DEQUEUE_TAG_SCRIPT: 'dequeueTagScript',
			    SAVE_IMAGE: 'saveImage',
			    GET_IMAGE: 'getImage',
			    DELETE_IMAGE: 'deleteImage',
			    CLEAR_IMAGES: 'clearImages',
			    SET_CSRF_TOKEN: 'setCsrfToken',
			    TAG_SCRIPT_POST_STATUS: 'tagScriptPostStatus'
			  })
			});
			// END: scripts/constants.js
			
			// START: scripts/core.js
			/* Minimal module registry with explicit dependencies.
			 * A wrong script order in manifest.json fails with a readable message instead of "undefined is not iterable". */
			globalThis.E621X = (function () {
			  'use strict';
			  const modules = new Map();
			
			  function get(name) {
			    if (!modules.has(name)) {
			      throw new Error(`[e621 extras] module "${name}" is not loaded — check script order in manifest.json`);
			    }
			    return modules.get(name);
			  }
			
			  function define(name, deps, factory) {
			    if (modules.has(name)) throw new Error(`[e621 extras] module "${name}" is defined twice`);
			    const resolved = deps.map(dep => {
			      if (!modules.has(dep)) {
			        throw new Error(`[e621 extras] module "${name}" requires "${dep}" — check script order in manifest.json`);
			      }
			      return modules.get(dep);
			    });
			    modules.set(name, Object.freeze(factory(...resolved)));
			  }
			
			  return { define, get };
			})();
			// END: scripts/core.js
			
			// START: scripts/selectors.js
			/* Every selector that depends on site markup (or on other scripts) lives here.
			 * After a site redesign, this is the only file to touch. */
			E621X.define('selectors', [], () => ({
			  // --- e621 markup ---
			  csrfMeta: 'meta[name="csrf-token"]',
			  postIdMeta: 'meta[name="post-id"]',
			  blacklistMeta: 'meta[name="blacklisted-tags"]',
			  siteUser: '#site-user',
			  imageContainer: '#image-container',
			  postInfoItems: '#post-information li',
			  postInfoLists: '#post-information ul',
			  thumbnail: 'article.thumbnail[data-id]',
			  postContainerForId: '[data-id], [data-post-id], article.thumbnail, article.post',
			  modeBox: '#mode-box',
			  modeSelect: '#mode-box-mode',
			  nativeTagScriptField: '#tag-script-field',
			  parentChildren: '.parent-children',
			  relationNotices: '.notice.notice-child, .notice.notice-parent',
			  voteButton: 'button[data-action="1"], button[data-action="-1"], .ptbr-vote-button',
			  commentVoteClasses: ['comment-vote-down-link', 'comment-vote-up-link'],
			
			  /* --- OPTIONAL integration with third-party scripts/extensions ---
			   * These are not part of e621. Everything works without them (defaults are used),
			   * but when present they give accurate vote state / thumbnail layout settings. */
			  thirdParty: {
			    voteContainer: '.ptbr-vote',
			    imageContainInput: '#ssc-image-contain',
			    cardSizeRadioName: 'ssc-card-size',
			    cornerRibbonsInput: '#ssc-corner-ribbons',
			    bodyAttrs: ['data-st-contain', 'data-st-size', 'data-st-cornerribbons'],
			    localStorageKeys: {
			      contain: 'e6.posts.contain',
			      size: 'e6.posts.size',
			      cornerRibbons: 'e6.posts.cribbons'
			    }
			  }
			}));
			// END: scripts/selectors.js
			
			// START: scripts/utils.js
			E621X.define('utils', ['selectors'], (SEL) => {
			  'use strict';
			  const { STORAGE_KEYS, SCHEMA_VERSION } = E621_CONSTANTS;
			  const TOAST_ID = 'e621-extras-toast';
			
			  const logWarn = (scope, err) => console.warn(`[e621 extras] ${scope}:`, err);
			  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
			  const extensionAlive = () => Boolean(globalThis.chrome?.runtime?.id);
			
			  // ---------- results ----------
			  const ok = (message, extra = {}) => ({ ok: true, message, ...extra });
			  const fail = (message, code = 'ERROR') => ({ ok: false, message, code });
			
			  // ---------- storage ----------
			  /* The extension context is invalidated after an update/reload; then storage calls must not throw. */
			  const storageGet = (key, fallback) => new Promise(resolve => {
			    if (!extensionAlive()) return resolve(fallback);
			    try {
			      chrome.storage.local.get([key], result => {
			        if (chrome.runtime.lastError) {
			          logWarn('storage.get', chrome.runtime.lastError.message);
			          return resolve(fallback);
			        }
			        resolve(result && result[key] !== undefined ? result[key] : fallback);
			      });
			    } catch (err) {
			      logWarn('storage.get', err);
			      resolve(fallback);
			    }
			  });
			
			  const storageSet = (key, value) => new Promise(resolve => {
			    if (!extensionAlive()) return resolve();
			    try {
			      chrome.storage.local.set({ [key]: value }, () => {
			        if (chrome.runtime.lastError) logWarn('storage.set', chrome.runtime.lastError.message);
			        resolve();
			      });
			    } catch (err) {
			      logWarn('storage.set', err);
			      resolve();
			    }
			  });
			
			  /* Idempotent migration. Uses the raw API on purpose: on a read failure we must NOT write fallbacks back. */
			  async function ensureStorageSchema() {
			    try {
			      const K = STORAGE_KEYS;
			      const data = await chrome.storage.local.get([K.SCHEMA_VERSION, K.DOWNVOTES]);
			      if ((data[K.SCHEMA_VERSION] || 0) >= SCHEMA_VERSION) return;
			      // v1: downvotes are stored as a de-duplicated array of numbers
			      const ids = Array.isArray(data[K.DOWNVOTES]) ? data[K.DOWNVOTES] : [];
			      await chrome.storage.local.set({
			        [K.DOWNVOTES]: [...new Set(ids.map(Number).filter(Number.isFinite))],
			        [K.SCHEMA_VERSION]: SCHEMA_VERSION
			      });
			    } catch (err) {
			      logWarn('schema migration', err);
			    }
			  }
			
			  // ---------- UI helpers ----------
			  function showToast(message, isError = false) {
			    document.getElementById(TOAST_ID)?.remove();
			    const toast = document.createElement('div');
			    toast.id = TOAST_ID;
			    toast.className = `e621x-toast${isError ? ' e621x-toast--error' : ''}`;
			    toast.textContent = message;
			    document.body.appendChild(toast);
			    setTimeout(() => {
			      toast.classList.add('is-hiding');
			      setTimeout(() => toast.remove(), 300);
			    }, 3500);
			  }
			
			  function downloadBlob(blob, filename) {
			    const url = URL.createObjectURL(blob);
			    const a = document.createElement('a');
			    a.href = url;
			    a.download = filename;
			    a.click();
			    URL.revokeObjectURL(url);
			  }
			
			  // ---------- site data ----------
			  function getCurrentUser() {
			    let userId = document.body?.dataset?.userId;
			    let userName = document.body?.dataset?.userName;
			    const isAnonymous = document.body?.dataset?.userIsAnonymous === 'true';
			
			    if (!userId || !userName || isAnonymous) {
			      const siteUserElem = document.querySelector(SEL.siteUser);
			      if (siteUserElem) {
			        try {
			          const data = JSON.parse(atob(siteUserElem.textContent.trim()));
			          if (data && data.name && !data.is?.anonymous) {
			            userId = String(data.id);
			            userName = data.name;
			          }
			        } catch (err) {
			          logWarn('parse #site-user', err);
			        }
			      }
			    }
			    if (!userId || !userName || isAnonymous) return null;
			    return { userId, userName };
			  }
			
			  const getCsrfToken = () => document.querySelector(SEL.csrfMeta)?.content || '';
			  const siteUrl = (path) => new URL(path, location.origin).href;
			
			  function getPostIdFromPage(el = null) {
			    if (el) {
			      const container = el.closest(SEL.postContainerForId);
			      if (container) {
			        const id = container.dataset.id || container.dataset.postId;
			        if (id && /^\d+$/.test(id)) return Number(id);
			      }
			    }
			    const meta = document.querySelector(SEL.postIdMeta);
			    if (meta?.content && /^\d+$/.test(meta.content)) return Number(meta.content);
			    const imgContainer = document.querySelector(SEL.imageContainer);
			    if (imgContainer?.dataset.id) return Number(imgContainer.dataset.id);
			    const match = location.pathname.match(/\/posts\/(\d+)/);
			    return match ? Number(match[1]) : null;
			  }
			
			  /* API posts expose tags either as `tag_string`, string `tags`, array, or category object. */
			  function getPostTagString(post) {
			    if (!post) return '';
			    if (typeof post.tag_string === 'string') return post.tag_string;
			    if (typeof post.tags === 'string') return post.tags;
			    if (Array.isArray(post.tags)) return post.tags.join(' ');
			    if (post.tags && typeof post.tags === 'object') return Object.values(post.tags).flat().join(' ');
			    return '';
			  }
			
			  // ---------- concurrency ----------
			  /* Runs tasks strictly one after another; a failed task does not block the next ones. */
			  function createQueue() {
			    let tail = Promise.resolve();
			    return {
			      run(task) {
			        const result = tail.then(task);
			        tail = result.catch(() => {});
			        return result;
			      }
			    };
			  }
			
			  async function mapLimit(items, limit, fn) {
			    const results = new Array(items.length);
			    let next = 0;
			    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
			      while (next < items.length) {
			        const i = next++;
			        results[i] = await fn(items[i], i);
			      }
			    });
			    await Promise.all(workers);
			    return results;
			  }
			
			  /* Collects cleanup callbacks; run() executes them once, in reverse order. */
			  function createDisposer() {
			    const fns = [];
			    let done = false;
			    return {
			      add(fn) { if (done) fn(); else fns.push(fn); },
			      isDisposed: () => done,
			      run() {
			        if (done) return;
			        done = true;
			        while (fns.length) {
			          try { fns.pop()(); } catch (err) { logWarn('disposer', err); }
			        }
			      }
			    };
			  }
			
			  return {
			    logWarn, sleep, ok, fail,
			    storageGet, storageSet, ensureStorageSchema,
			    showToast, downloadBlob,
			    getCurrentUser, getCsrfToken, siteUrl, getPostIdFromPage, getPostTagString,
			    createQueue, mapLimit, createDisposer
			  };
			});
			// END: scripts/utils.js
			
			// START: scripts/net.js
			/* The only place that talks to the site API: one global throttle + bounded retries with backoff. */
			E621X.define('net', ['utils'], (U) => {
			  'use strict';
			
			  const MIN_INTERVAL_MS = 550;      // spacing between ANY two requests from this tab
			  const MAX_RETRIES = 4;
			  const BASE_BACKOFF_MS = 2000;
			  const MAX_BACKOFF_MS = 30000;
			  const RETRY_STATUSES = new Set([429, 502, 503, 504]);
			
			  class HttpError extends Error {
			    constructor(status, url) {
			      super(status ? `HTTP ${status}` : 'Network error');
			      this.name = 'HttpError';
			      this.status = status;
			      this.url = url;
			    }
			  }
			
			  let nextSlot = 0;
			  function waitForSlot() {
			    const now = Date.now();
			    const slot = Math.max(now, nextSlot);
			    nextSlot = slot + MIN_INTERVAL_MS;
			    return U.sleep(slot - now);
			  }
			
			  function backoffDelay(attempt, res) {
			    const retryAfter = Number(res?.headers.get('Retry-After'));
			    if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, MAX_BACKOFF_MS);
			    return Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
			  }
			
			  /* Resolves with any non-retryable response (including 4xx); throws HttpError when retries are exhausted. */
			  async function request(url, init = {}, { retries = MAX_RETRIES } = {}) {
			    for (let attempt = 0; ; attempt++) {
			      await waitForSlot();
			      let res = null;
			      try {
			        res = await fetch(url, init);
			      } catch (err) {
			        if (attempt >= retries) throw new HttpError(0, url);
			      }
			      if (res && !RETRY_STATUSES.has(res.status)) return res;
			      if (attempt >= retries) throw new HttpError(res.status, url);
			      await U.sleep(backoffDelay(attempt, res));
			    }
			  }
			
			  async function fetchJson(url, init, opts) {
			    const res = await request(url, init, opts);
			    if (!res.ok) throw new HttpError(res.status, url);
			    return res.json();
			  }
			
			  function sendForm(url, method, params, opts) {
			    return request(url, {
			      method,
			      headers: {
			        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
			        'X-CSRF-Token': U.getCsrfToken()
			      },
			      body: new URLSearchParams(params).toString()
			    }, opts);
			  }
			
			  return { request, fetchJson, sendForm, HttpError };
			});
			// END: scripts/net.js
			
			// START: scripts/ui/dom.js
			E621X.define('dom', [], () => {
			  'use strict';
			
			  const ICONS = {
			    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
			    star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"></path>',
			    messages_square: '<path d="M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path><path d="M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1"></path>',
			    arrow_up_dash: '<path d="M9 13a1 1 0 0 0-1-1H5.061a1 1 0 0 1-.75-1.811l6.836-6.835a1.207 1.207 0 0 1 1.707 0l6.835 6.835a1.207 1.207 0 0 1-.75 1.811H16a1 1 0 0 0-1 1v2a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1z"></path><path d="M9 20h6"></path>',
			    arrow_down_dash: '<path d="M15 11a1 1 0 0 0 1 1h2.939a1 1 0 0 1 .75 1.811l-6.835 6.836a1.207 1.207 0 0 1-1.707 0L4.31 13.81a1 1 0 0 1 .75-1.811H8a1 1 0 0 0 1-1V9a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1z"></path><path d="M9 4h6"></path>'
			  };
			
			  /* Safe element factory: values go through setAttribute/textContent, never through innerHTML. */
			  function el(tag, attrs = {}, children = []) {
			    const node = document.createElement(tag);
			    for (const [key, value] of Object.entries(attrs)) {
			      if (value === null || value === undefined || value === false) continue;
			      if (key === 'class') node.className = value;
			      else if (key === 'text') node.textContent = String(value);
			      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
			      else node.setAttribute(key, value === true ? '' : String(value));
			    }
			    for (const child of [].concat(children)) {
			      if (child !== null && child !== undefined && child !== false) node.append(child);
			    }
			    return node;
			  }
			
			  function icon(name, size = 16) {
			    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
			    svg.setAttribute('width', size);
			    svg.setAttribute('height', size);
			    svg.setAttribute('viewBox', '0 0 24 24');
			    svg.setAttribute('fill', 'none');
			    svg.setAttribute('stroke', 'currentColor');
			    svg.setAttribute('stroke-width', '2');
			    svg.setAttribute('stroke-linecap', 'round');
			    svg.setAttribute('stroke-linejoin', 'round');
			    svg.setAttribute('name', name);
			    svg.innerHTML = ICONS[name] || ''; // ICONS is a static trusted table
			    return svg;
			  }
			
			  function button({ text = '', icon: iconName = null, kinetic = true, primary = false, onClick = null, title = '', className = '' } = {}) {
			    const btn = el('button', {
			      type: 'button',
			      class: `${primary ? 'btn' : 'st-button'} ${kinetic ? 'kinetic' : ''} ${className}`.trim(),
			      title
			    });
			    if (iconName && ICONS[iconName]) btn.appendChild(icon(iconName, 16));
			    if (text) btn.appendChild(el('span', { text }));
			    if (typeof onClick === 'function') btn.addEventListener('click', onClick);
			    return btn;
			  }
			
			  /* Escapes text for HTML and XML (text nodes and quoted attributes). */
			  function escapeHtml(value) {
			    if (value === null || value === undefined) return '';
			    return String(value)
			      .replace(/&/g, '&amp;')
			      .replace(/"/g, '&quot;')
			      .replace(/'/g, '&#39;')
			      .replace(/</g, '&lt;')
			      .replace(/>/g, '&gt;');
			  }
			
			  function formatCount(num) {
			    if (num === null || num === undefined) return '0';
			    const n = Number(num);
			    if (Math.abs(n) >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'm';
			    if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
			    return String(n);
			  }
			
			  function formatDate(isoStr) {
			    if (!isoStr) return '';
			    const d = new Date(isoStr);
			    if (isNaN(d.getTime())) return String(isoStr);
			    const pad = n => String(n).padStart(2, '0');
			    const offsetMin = -d.getTimezoneOffset();
			    const sign = offsetMin >= 0 ? '+' : '-';
			    const offH = pad(Math.floor(Math.abs(offsetMin) / 60));
			    const offM = pad(Math.abs(offsetMin) % 60);
			    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
			           `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${sign}${offH}${offM}`;
			  }
			
			  return { el, icon, button, escapeHtml, formatCount, formatDate };
			});
			// END: scripts/ui/dom.js
			
			// START: scripts/ui/layout.js
			/* Reads thumbnail layout preferences (card size, contain/cover, ribbons).
			 * Uses third-party settings when present (see selectors.thirdParty), otherwise defaults. */
			E621X.define('layout', ['selectors'], (SEL) => {
			  'use strict';
			  const TP = SEL.thirdParty;
			
			  const CARD_SIZES = {
			    s: { width: 120, height: 165 },
			    m: { width: 160, height: 210 },
			    l: { width: 220, height: 285 }
			  };
			  const getCardDimensions = (size = 'm') => CARD_SIZES[size] || CARD_SIZES.m;
			
			  function getLayoutSettings() {
			    const body = document.body;
			    const ls = TP.localStorageKeys;
			
			    const containInput = document.querySelector(TP.imageContainInput);
			    const isContain = containInput
			      ? containInput.checked
			      : (body.getAttribute('data-st-contain') === 'true' || localStorage.getItem(ls.contain) === 'true');
			
			    const checkedRadio = document.querySelector(`input[name="${TP.cardSizeRadioName}"]:checked`);
			    const size = checkedRadio
			      ? checkedRadio.value
			      : (body.getAttribute('data-st-size') || localStorage.getItem(ls.size) || 'm');
			
			    const ribbonsInput = document.querySelector(TP.cornerRibbonsInput);
			    const showRibbons = ribbonsInput
			      ? ribbonsInput.checked
			      : (body.getAttribute('data-st-cornerribbons') !== 'false' && localStorage.getItem(ls.cornerRibbons) !== 'false');
			
			    return { isContain, size, showRibbons };
			  }
			
			  /* Card size / fit are CSS variables consumed by .e621x-thumb (see styles/extras.css). */
			  function applyLayoutVars(element, layout) {
			    const dims = getCardDimensions(layout.size);
			    element.style.setProperty('--e621x-w', `${dims.width}px`);
			    element.style.setProperty('--e621x-h', `${dims.height}px`);
			    element.style.setProperty('--e621x-fit', layout.isContain ? 'contain' : 'cover');
			  }
			
			  // One shared DOM listener + observer for all subscribers; fully detached when nobody listens.
			  const listeners = new Set();
			  let observer = null;
			
			  const notify = () => {
			    const settings = getLayoutSettings();
			    listeners.forEach(cb => cb(settings));
			  };
			
			  const onDocumentChange = (e) => {
			    const t = e.target;
			    if (t && (t.matches?.(TP.imageContainInput) || t.name === TP.cardSizeRadioName || t.matches?.(TP.cornerRibbonsInput))) {
			      notify();
			    }
			  };
			
			  /* Returns an unsubscribe function. */
			  function onLayoutSettingsChange(callback) {
			    listeners.add(callback);
			    if (listeners.size === 1) {
			      document.addEventListener('change', onDocumentChange);
			      observer = new MutationObserver(notify);
			      observer.observe(document.body, { attributes: true, attributeFilter: TP.bodyAttrs });
			    }
			    return () => {
			      listeners.delete(callback);
			      if (listeners.size === 0) {
			        document.removeEventListener('change', onDocumentChange);
			        observer?.disconnect();
			        observer = null;
			      }
			    };
			  }
			
			  return { getLayoutSettings, applyLayoutVars, onLayoutSettingsChange, getCardDimensions };
			});
			// END: scripts/ui/layout.js
			
			// START: scripts/ui/thumbnail.js
			E621X.define('thumbnail', ['utils', 'dom', 'layout'], (U, D, Layout) => {
			  'use strict';
			  const { el, icon, formatCount, formatDate } = D;
			
			  function createPin(position, gen) {
			    return el('div', {
			      class: `e621x-pin e621x-pin--${position}`,
			      title: `Generation ${gen}`,
			      text: gen
			    });
			  }
			
			  function createStat(extraClass, iconName, value) {
			    return el('span', { class: `thm-desc-m ${extraClass}` }, [icon(iconName, 16), ` ${value}`]);
			  }
			
			  /* Builds a card in the site's own thumbnail markup (so site CSS/JS treat it as native).
			   * Card size and object-fit come from CSS variables set by the container (Layout.applyLayoutVars). */
			  function createThumbnail(post, options = {}) {
			    const {
			      layout = Layout.getLayoutSettings(),
			      gen = 1,
			      hasParent = false,
			      hasChildren = false,
			      enablePins = true
			    } = options;
			
			    const rating = (post.rating || 's').toLowerCase();
			    const ratingClass = rating === 's' ? 'rating-safe' : (rating === 'q' ? 'rating-questionable' : 'rating-explicit');
			    const allTags = U.getPostTagString(post);
			    let flagsStr = '';
			    if (Array.isArray(post.flags)) {
			      flagsStr = post.flags.join(' ');
			    } else if (typeof post.flags === 'string') {
			      flagsStr = post.flags;
			    } else if (post.flags && typeof post.flags === 'object') {
			      flagsStr = Object.entries(post.flags).filter(([, v]) => Boolean(v)).map(([k]) => k).join(' ');
			    }
			
			    const ext = post.file?.ext || post.file_ext || post.fileExt || 'jpg';
			    const fallbackUrl = U.siteUrl('/images/download-preview.png');
			    const rawPreviewUrl = post.preview?.url || post.preview_url || post.previewUrl || '';
			    const hasPreview = Boolean(rawPreviewUrl && ext !== 'swf');
			    const previewUrl = hasPreview ? rawPreviewUrl : fallbackUrl;
			    const isDataUrl = previewUrl.startsWith('data:');
			    const previewWebp = (hasPreview && !isDataUrl) ? previewUrl.replace(/\.[a-zA-Z0-9]+$/, '.webp') : null;
			
			    const score = (typeof post.score === 'object' && post.score !== null)
			      ? (post.score.total ?? 0)
			      : (Number(post.score) || 0);
			    const favCount = post.fav_count ?? post.favCount ?? 0;
			    const commentCount = post.comment_count ?? post.commentCount ?? 0;
			
			    const isDeleted = flagsStr.includes('deleted');
			    const isFlagged = flagsStr.includes('flagged');
			    const isPending = flagsStr.includes('pending');
			    const statusStr = isDeleted ? 'deleted' : (isFlagged ? 'flagged' : (isPending ? 'pending' : 'active'));
			    const vote = post.own_vote ?? post.vote ?? 0;
			
			    const hasParentPost = hasParent || Boolean(post.relationships?.parent_id || post.has_parent || post.hasParent);
			    const hasChildrenPost = hasChildren || Boolean(post.relationships?.has_children || post.has_children || post.hasChildren);
			
			    const hoverText = `Rating: ${rating}\nID: ${post.id}\nDate: ${formatDate(post.created_at)}\nStatus: ${statusStr}\nScore: ${score}\n\n${allTags}`;
			
			    const img = el('img', {
			      class: 'thm-img-thumb',
			      src: previewUrl,
			      alt: `post #${post.id}`,
			      fetchpriority: 'high'
			    });
			    img.addEventListener('error', () => {
			      if (!img.src.startsWith('data:')) img.src = fallbackUrl;
			    }, { once: true });
			
			    const pictureChildren = [];
			    if (previewWebp) {
			      pictureChildren.push(el('source', { type: 'image/webp', srcset: previewWebp }));
			    }
			    if (!isDataUrl) {
			      pictureChildren.push(el('source', { type: `image/${ext === 'png' ? 'png' : 'jpeg'}`, srcset: previewUrl }));
			    }
			    pictureChildren.push(img);
			
			    const picture = el('picture', {}, pictureChildren);
			
			    const link = el('a', {
			      class: 'thm-link',
			      href: `/posts/${post.id}`,
			      target: '_blank',
			      rel: 'noopener',
			      title: hoverText,
			      'data-hover-text': hoverText,
			      'data-file-ext': ext
			    }, [
			      picture,
			      layout.showRibbons && hasParentPost && el('div', { class: 'ribbon left', title: 'Has a parent post.' }),
			      layout.showRibbons && hasChildrenPost && el('div', { class: 'ribbon right', title: 'Has children.' })
			    ]);
			
			    const isNegative = score < 0;
			    const scoreClass = isNegative ? 'thm-score-negative' : (score > 0 ? 'thm-score-positive' : '');
			
			    const desc = el('div', { class: `thm-desc thm-rating-${rating}` }, [
			      el('span', { class: 'thm-desc-a' }, [
			        createStat(`thm-score ${scoreClass}`, isNegative ? 'arrow_down_dash' : 'arrow_up_dash', formatCount(Math.abs(score))),
			        createStat('thm-favorites', 'star', formatCount(favCount)),
			        createStat('thm-comments', 'messages_square', formatCount(commentCount))
			      ]),
			      el('span', { class: 'thm-desc-b thm-rating', text: rating.toUpperCase() })
			    ]);
			
			    return el('article', {
			      class: `thumbnail e621x-thumb ${ratingClass} filter-matches`,
			      'data-id': post.id,
			      'data-flags': flagsStr,
			      'data-tags': allTags,
			      'data-rating': rating,
			      'data-file-ext': ext,
			      'data-width': post.file?.width ?? post.width ?? 0,
			      'data-height': post.file?.height ?? post.height ?? 0,
			      'data-size': post.file?.size ?? post.size ?? 0,
			      'data-created-at': JSON.stringify(post.created_at || ''),
			      'data-uploader': post.uploader || '',
			      'data-uploader-id': post.uploader_id ?? post.uploaderId ?? '',
			      'data-score': score,
			      'data-fav-count': favCount,
			      'data-is-favorited': String(Boolean(post.is_favorited)),
			      'data-vote': String(vote),
			      'data-comment-count': commentCount,
			      'data-pools': Array.isArray(post.pools) ? post.pools.join(' ') : (post.pools || ''),
			      'data-md5': post.file?.md5 || post.md5 || '',
			      'data-preview-url': previewUrl,
			      'data-preview-webp': previewWebp || '',
			      'data-sample-url': post.sample?.url || post.sample_url || '',
			      'data-file-url': post.file?.url || post.file_url || '',
			      'data-preview-width': post.preview?.width ?? 0,
			      'data-preview-height': post.preview?.height ?? 0
			    }, [
			      enablePins && hasParentPost && createPin('top', gen),
			      enablePins && hasChildrenPost && createPin('bottom', gen),
			      link,
			      desc
			    ]);
			  }
			
			  return { createThumbnail };
			});
			// END: scripts/ui/thumbnail.js
			
			// START: scripts/ui/dtext.js
			E621X.define('dtext', ['dom'], (D) => {
			  'use strict';
			  const { escapeHtml } = D;
			
			  /* Safe client-side DText parser (escapes before formatting to prevent XSS). */
			  function parseDText(rawText) {
			    if (!rawText) return '';
			
			    let text = String(rawText).replace(/\r\n?/g, '\n');
			    const blocks = [];
			    const inlineCodes = [];
			
			    const stashBlock = (html) => {
			      blocks.push(html);
			      return `\n\n\u0000B${blocks.length - 1}\u0000\n\n`;
			    };
			
			    // 1. [code] blocks
			    text = text.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, (_, code) =>
			      stashBlock(`<pre class="dtext-code"><code>${escapeHtml(code.trim())}</code></pre>`));
			
			    // 2. Inline `code`
			    text = text.replace(/`([^`\n]+)`/g, (_, code) => {
			      inlineCodes.push(`<code class="inline-code">${escapeHtml(code)}</code>`);
			      return `\u0000C${inlineCodes.length - 1}\u0000`;
			    });
			
			    // 3. Escape everything remaining
			    text = escapeHtml(text);
			
			    // 4. [quote] tags -> structural markers
			    text = text
			      .replace(/\[quote(?:=[^\]]+)?\]/gi, '\n\u0000Q_OPEN\u0000\n')
			      .replace(/\[\/quote\]/gi, '\n\u0000Q_CLOSE\u0000\n');
			
			    // 5. Inline styles
			    text = text
			      .replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong>$1</strong>')
			      .replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<em>$1</em>')
			      .replace(/\[s\]([\s\S]*?)\[\/s\]/gi, '<s>$1</s>')
			      .replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '<u>$1</u>');
			
			    // 6. Links (handles optional [brackets] for both full and relative URLs)
			    text = text
			      .replace(/&quot;((?:(?!&quot;).)+)&quot;:\[?(https?:\/\/[^\s\]<]+)\]?/g,
			        (_, label, url) => `<a href="${url}" rel="nofollow noreferrer" target="_blank">${label}</a>`)
			      .replace(/&quot;((?:(?!&quot;).)+)&quot;:\[?(\/(?!\/)[^\s\]<]*)\]?/g,
			        (_, label, path) => `<a href="${path}">${label}</a>`)
			      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g,
			        (_, title, label) => `<a href="/wiki_pages/show_or_new?title=${encodeURIComponent(title)}">${label}</a>`)
			      .replace(/\[\[([^\]]+)\]\]/g,
			        (_, title) => `<a href="/wiki_pages/show_or_new?title=${encodeURIComponent(title)}">${title}</a>`)
			      .replace(/\bpost #(\d+)/gi, '<a href="/posts/$1">post #$1</a>')
			      .replace(/\buser #(\d+)/gi, '<a href="/users/$1">user #$1</a>')
			      .replace(/\btopic #(\d+)/gi, '<a href="/forum_topics/$1">topic #$1</a>');
			
			    // 7. Structural line parsing: headers, lists, quotes, paragraphs
			    const result = [];
			    let listLevel = 0;
			    let paragraph = [];
			
			    const flushParagraph = () => {
			      const content = paragraph.join('<br>').trim();
			      if (content) result.push(`<p>${content}</p>`);
			      paragraph = [];
			    };
			    const closeList = () => {
			      while (listLevel > 0) { result.push('</ul>'); listLevel--; }
			    };
			
			    for (const line of text.split('\n')) {
			      const trimmed = line.trim();
			
			      if (!trimmed) {
			        flushParagraph();
			        continue;
			      }
			
			      if (trimmed === '\u0000Q_OPEN\u0000') {
			        flushParagraph();
			        closeList();
			        result.push('<blockquote class="dtext-quote">');
			        continue;
			      }
			
			      if (trimmed === '\u0000Q_CLOSE\u0000') {
			        flushParagraph();
			        closeList();
			        result.push('</blockquote>');
			        continue;
			      }
			
			      if (/^\u0000B\d+\u0000$/.test(trimmed)) {
			        flushParagraph();
			        closeList();
			        result.push(trimmed);
			        continue;
			      }
			
			      const header = trimmed.match(/^h([1-6])(?:#([a-zA-Z0-9_-]+))?\.\s+(.*)$/);
			      if (header) {
			        flushParagraph();
			        closeList();
			        result.push(`<h${header[1]}${header[2] ? ` id="${header[2]}"` : ''}>${header[3]}</h${header[1]}>`);
			        continue;
			      }
			
			      const item = trimmed.match(/^(\*+)\s+(.*)$/);
			      if (item) {
			        flushParagraph();
			        while (listLevel < item[1].length) { result.push('<ul>'); listLevel++; }
			        while (listLevel > item[1].length) { result.push('</ul>'); listLevel--; }
			        result.push(`<li>${item[2]}</li>`);
			        continue;
			      }
			
			      closeList();
			      paragraph.push(trimmed);
			    }
			    flushParagraph();
			    closeList();
			
			    // 8. Restore stashed blocks and inline codes
			    return result.join('\n')
			      .replace(/\u0000B(\d+)\u0000/g, (_, i) => blocks[Number(i)])
			      .replace(/\u0000C(\d+)\u0000/g, (_, i) => inlineCodes[Number(i)]);
			  }
			
			  return { parseDText, renderDText: async (text) => parseDText(text) };
			});
			// END: scripts/ui/dtext.js
			
			// START: scripts/ui/tooltips.js
			/* Tooltip suppressor: permanently disables native browser hover tooltips on thumbnails when enabled. */
			E621X.define('tooltipsManager', ['utils', 'selectors'], (U, SEL) => {
			  'use strict';
			  const { STORAGE_KEYS: KEYS } = E621_CONSTANTS;
			
			  let enabled = false;
			
			  function suppressTitle(el) {
			    if (!el) return;
			    const targets = el.hasAttribute('title') ? [el] : [];
			    targets.push(...el.querySelectorAll('[title]'));
			    for (const t of targets) {
			      const val = t.getAttribute('title');
			      if (val) {
			        t.setAttribute('data-stashed-title', val);
			        t.removeAttribute('title');
			      }
			    }
			  }
			
			  function restoreTitle(el) {
			    if (!el) return;
			    const targets = el.hasAttribute('data-stashed-title') ? [el] : [];
			    targets.push(...el.querySelectorAll('[data-stashed-title]'));
			    for (const t of targets) {
			      const val = t.getAttribute('data-stashed-title');
			      if (val) {
			        t.setAttribute('title', val);
			        t.removeAttribute('data-stashed-title');
			      }
			    }
			  }
			
			  function setupListeners() {
			    document.addEventListener('mouseover', (e) => {
			      if (!enabled) return;
			      const thumb = e.target.closest(SEL.thumbnail) || e.target.closest('.post-preview, div.post-thumbnail, .e621x-thumb, [data-id]');
			      if (thumb) {
			        suppressTitle(thumb);
			      }
			    }, true);
			  }
			
			  async function init() {
			    enabled = Boolean(await U.storageGet(KEYS.HIDE_THUMB_TOOLTIPS, false));
			    setupListeners();
			
			    chrome.storage.onChanged.addListener((changes, area) => {
			      if (area === 'local' && changes[KEYS.HIDE_THUMB_TOOLTIPS]) {
			        enabled = Boolean(changes[KEYS.HIDE_THUMB_TOOLTIPS].newValue);
			        if (!enabled) {
			          document.querySelectorAll('[data-stashed-title]').forEach(restoreTitle);
			        }
			      }
			    });
			  }
			
			  return { init };
			});
			// END: scripts/ui/tooltips.js
			
			// START: scripts/blacklist.js
			/* Blacklist / downvotes manager.
			 *
			 * Glossary (popup labels map to these):
			 *   downvotes        – IDs of posts the user downvoted on the site.
			 *   loadDownvotes    – site API  -> extension storage.
			 *   uploadDownvotes  – storage   -> site blacklist (adds `id:N` rules).
			 *   unloadDownvotes  – removes the `id:N` rules of stored downvotes from the blacklist.
			 *   backupBlacklist  – live blacklist -> extension storage (disabled while LOCKED).
			 *   LOCKED           – set while `id:N` rules are in the blacklist, so a backup would be polluted.
			 *
			 * Invariants:
			 *  - every public operation runs through ONE queue (no lost read-modify-write updates);
			 *  - the blacklist is persisted via the API and checked (res.ok) BEFORE local flags change;
			 *  - operations return Result objects ({ ok, message, code }), never magic strings.
			 */
			E621X.define('blacklist', ['utils', 'selectors', 'net'], (U, SEL, Net) => {
			  'use strict';
			  const { STORAGE_KEYS: KEYS } = E621_CONSTANTS;
			  const { ok, fail } = U;
			
			  const DOWNVOTES_PAGE_LIMIT = 320;
			  const RELOAD_DELAY_MS = 1500;
			
			  const queue = U.createQueue();
			  let reloadTimer = null;
			
			  // ---------- helpers ----------
			  const parseBlacklistText = (text) => String(text || '').split('\n').map(t => t.trim()).filter(Boolean);
			
			  function idFromRule(rule) {
			    const m = String(rule).trim().match(/^id:(\d+)$/i);
			    return m ? Number(m[1]) : null;
			  }
			
			  const readDownvotes = async () => (await U.storageGet(KEYS.DOWNVOTES, [])).map(Number);
			
			  /* Debounced: several operations in a row cause a single reload, after all writes and toasts. */
			  function scheduleReload() {
			    clearTimeout(reloadTimer);
			    reloadTimer = setTimeout(() => location.reload(), RELOAD_DELAY_MS);
			  }
			
			  const notLoggedIn = () => {
			    U.showToast('Sign in to e621 first', true);
			    return fail('Not logged in', 'NOT_LOGGED_IN');
			  };
			
			  const failFromError = (err) => {
			    U.logWarn('blacklist', err);
			    U.showToast(`Error: ${err.message}`, true);
			    return fail(err.message);
			  };
			
			  // ---------- blacklist I/O ----------
			  /* Reads directly from the page DOM (meta tag or #site-user) to avoid unnecessary HTTP requests. */
			  function readDomBlacklist() {
			    const meta = document.querySelector(SEL.blacklistMeta);
			    if (meta?.content) {
			      try {
			        const parsed = JSON.parse(meta.content);
			        if (Array.isArray(parsed)) return parsed.map(t => String(t).trim()).filter(Boolean);
			      } catch (err) {
			        U.logWarn('parsing blacklist meta tag', err);
			      }
			    }
			
			    const siteUser = document.querySelector(SEL.siteUser);
			    if (siteUser) {
			      try {
			        const data = JSON.parse(atob(siteUser.textContent.trim()));
			        if (Array.isArray(data?.blacklist)) return data.blacklist.map(t => String(t).trim()).filter(Boolean);
			      } catch (err) {
			        U.logWarn('parsing site-user blacklist', err);
			      }
			    }
			
			    return null;
			  }
			
			  /* Reads DOM first to avoid spamming /users/me.json on single downvotes.
			   * Falls back to API or forces API read for backups. */
			  async function fetchLiveBlacklist(forceApi = false) {
			    if (!forceApi) {
			      const domRules = readDomBlacklist();
			      if (domRules) return domRules;
			    }
			
			    try {
			      const data = await Net.fetchJson('/users/me.json');
			      if (typeof data.blacklisted_tags === 'string') return parseBlacklistText(data.blacklisted_tags);
			    } catch (err) {
			      U.logWarn('reading blacklist via API failed, checking DOM fallback', err);
			    }
			
			    const fallbackDom = readDomBlacklist();
			    if (fallbackDom) return fallbackDom;
			
			    throw new Error('Cannot read the current blacklist');
			  }
			
			  async function saveBlacklist(userId, rules) {
			    const res = await Net.sendForm(`/users/${userId}.json`, 'PATCH', {
			      'user[blacklisted_tags]': rules.join('\n')
			    });
			    if (!res.ok) throw new Net.HttpError(res.status, res.url);
			
			    // Keep the in-DOM meta tag updated so subsequent operations read without network round-trips
			    const meta = document.querySelector(SEL.blacklistMeta);
			    if (meta) meta.content = JSON.stringify(rules);
			  }
			
			  // ---------- operations (internal, NOT queued; composed by the public wrappers) ----------
			  async function backupBlacklistImpl() {
			    if (await U.storageGet(KEYS.BLACKLIST_LOCKED, false)) {
			      const msg = 'Disabled: downvotes are in blacklist.';
			      U.showToast(msg, true);
			      return fail(msg, 'LOCKED');
			    }
			    const user = U.getCurrentUser();
			    if (!user) return notLoggedIn();
			    try {
			      U.showToast('Backing up blacklist...');
			      const rules = await fetchLiveBlacklist(true); // force fresh API read for backups
			      await U.storageSet(KEYS.BLACKLIST_BACKUP, rules);
			      const msg = `Backup saved (${rules.length} rules)`;
			      U.showToast(msg);
			      return ok(msg);
			    } catch (err) {
			      return failFromError(err);
			    }
			  }
			
			  async function loadDownvotesImpl() {
			    const user = U.getCurrentUser();
			    if (!user) return notLoggedIn();
			    try {
			      U.showToast('Fetching downvoted posts...');
			      const ids = new Set();
			      let lowestId = null;
			
			      for (;;) {
			        let url = `/posts.json?tags=downvoted:${encodeURIComponent(user.userName)}&limit=${DOWNVOTES_PAGE_LIMIT}`;
			        if (lowestId) url += `&page=b${lowestId}`;
			        const data = await Net.fetchJson(url);
			        const posts = Array.isArray(data) ? data : (data.posts || []);
			        if (!posts.length) break;
			
			        posts.forEach(p => ids.add(p.id));
			        lowestId = Math.min(...posts.map(p => p.id));
			        if (posts.length < DOWNVOTES_PAGE_LIMIT) break;
			      }
			
			      await U.storageSet(KEYS.DOWNVOTES, [...ids]);
			      const msg = `Loaded ${ids.size} downvotes`;
			      U.showToast(msg);
			      return ok(msg);
			    } catch (err) {
			      return failFromError(err);
			    }
			  }
			
			  async function uploadDownvotesImpl() {
			    const user = U.getCurrentUser();
			    if (!user) return notLoggedIn();
			
			    const downvoted = await readDownvotes();
			    if (!downvoted.length) {
			      U.showToast('No saved downvotes found', true);
			      return fail('No downvotes in storage', 'NO_DOWNVOTES');
			    }
			
			    try {
			      U.showToast('Processing blacklist update...');
			      const current = await fetchLiveBlacklist();
			      const existing = new Set(current.map(idFromRule).filter(id => id !== null));
			      const toAdd = downvoted.filter(id => !existing.has(id));
			
			      if (toAdd.length) {
			        await saveBlacklist(user.userId, [...current, ...toAdd.map(id => `id:${id}`)]);
			      }
			      await U.storageSet(KEYS.BLACKLIST_LOCKED, true); // only after a successful save
			
			      if (!toAdd.length) {
			        U.showToast('All downvotes already blacklisted');
			        return ok('Already up to date');
			      }
			      const msg = `Added ${toAdd.length} posts to blacklist`;
			      U.showToast(msg);
			      scheduleReload();
			      return ok(msg);
			    } catch (err) {
			      return failFromError(err);
			    }
			  }
			
			  async function unloadDownvotesImpl() {
			    const user = U.getCurrentUser();
			    if (!user) return notLoggedIn();
			
			    const downvoted = new Set(await readDownvotes());
			    if (!downvoted.size) {
			      U.showToast('No downvotes stored to match', true);
			      return fail('No downvotes in storage', 'NO_DOWNVOTES');
			    }
			
			    try {
			      U.showToast('Removing downvotes...');
			      const current = await fetchLiveBlacklist();
			      const updated = current.filter(rule => !downvoted.has(idFromRule(rule)));
			      const removed = current.length - updated.length;
			
			      if (removed) await saveBlacklist(user.userId, updated);
			      await U.storageSet(KEYS.BLACKLIST_LOCKED, false); // only after a successful save
			
			      if (!removed) {
			        U.showToast('No downvotes found in blacklist');
			        return ok('None found to remove');
			      }
			      const msg = `Removed ${removed} posts`;
			      U.showToast(msg);
			      scheduleReload();
			      return ok(msg);
			    } catch (err) {
			      return failFromError(err);
			    }
			  }
			
			  async function syncApiImpl() {
			    const loaded = await loadDownvotesImpl();
			    if (!loaded.ok) return loaded;
			    return uploadDownvotesImpl();
			  }
			
			  async function toggleAutoUpdateImpl() {
			    if (await U.storageGet(KEYS.AUTO_UPDATE, false)) {
			      await U.storageSet(KEYS.AUTO_UPDATE, false);
			      U.showToast('Auto Update disabled');
			      return ok('Auto Update OFF');
			    }
			
			    U.showToast('Auto Update: syncing downvotes via API...');
			    const result = await syncApiImpl();
			    // "no downvotes yet" is fine; any other failure must NOT enable auto mode
			    if (!result.ok && result.code !== 'NO_DOWNVOTES') {
			      return fail(`Auto Update not enabled: ${result.message}`, result.code);
			    }
			    await U.storageSet(KEYS.AUTO_UPDATE, true);
			    U.showToast('Auto Update enabled & synced');
			    return ok(`Auto Update ON (${result.message})`);
			  }
			
			  // ---------- auto mode: single votes (throw on failure, caller reports) ----------
			  async function addPost(postId) {
			    const user = U.getCurrentUser();
			    if (!user) throw new Error('Not logged in');
			
			    const current = await fetchLiveBlacklist();
			    const rule = `id:${postId}`;
			    const present = current.some(r => r.trim().toLowerCase() === rule);
			    if (!present) await saveBlacklist(user.userId, [...current, rule]);
			
			    const ids = new Set(await readDownvotes());
			    ids.add(postId);
			    await U.storageSet(KEYS.DOWNVOTES, [...ids]);
			    await U.storageSet(KEYS.BLACKLIST_LOCKED, true);
			    if (!present) U.showToast(`Auto: #${postId} blacklisted (applies after reload)`);
			  }
			
			  async function removePost(postId) {
			    const user = U.getCurrentUser();
			    if (!user) throw new Error('Not logged in');
			
			    const current = await fetchLiveBlacklist();
			    const rule = `id:${postId}`;
			    const updated = current.filter(r => r.trim().toLowerCase() !== rule);
			    if (updated.length !== current.length) await saveBlacklist(user.userId, updated);
			
			    const ids = (await readDownvotes()).filter(id => id !== postId);
			    await U.storageSet(KEYS.DOWNVOTES, ids);
			    if (updated.length !== current.length) U.showToast(`Auto: #${postId} un-blacklisted`);
			  }
			
			  /* Vote state of the button's own post. A global querySelector fallback is only valid on a post page
			   * (button outside any thumbnail); on listings it would return another post's state. */
			  function readVoteState(voteBtn) {
			    let container = voteBtn.closest(SEL.thirdParty.voteContainer);
			    if (!container && !voteBtn.closest('article.thumbnail')) {
			      container = document.querySelector(SEL.thirdParty.voteContainer);
			    }
			    return container ? String(container.dataset.vote || '0') : null; // null = unknown
			  }
			
			  async function handleVote(action, postId, domState) {
			    if (!(await U.storageGet(KEYS.AUTO_UPDATE, false))) return;
			    try {
			      await queue.run(async () => {
			        const wasDownvoted = domState !== null
			          ? domState === '-1'
			          : (await readDownvotes()).includes(postId); // unknown DOM state: trust our own record
			        if (action === '-1') {
			          return wasDownvoted ? removePost(postId) : addPost(postId);
			        }
			        if (action === '1' && wasDownvoted) return removePost(postId);
			      });
			    } catch (err) {
			      U.logWarn('vote sync', err);
			      U.showToast(`Blacklist sync failed for #${postId}: ${err.message}`, true);
			    }
			  }
			
			  function setupVoteListener() {
			    document.addEventListener('click', (e) => {
			      const voteBtn = e.target.closest(SEL.voteButton);
			      if (!voteBtn) return;
			      if (SEL.commentVoteClasses.some(c => voteBtn.classList.contains(c))) return;
			      if (!chrome.runtime?.id) return;
			
			      const action = voteBtn.dataset.action;
			      if (action !== '1' && action !== '-1') return;
			      const postId = U.getPostIdFromPage(voteBtn);
			      if (!postId) return;
			
			      // Must be read synchronously: the site's own handler mutates the state right after this capture listener.
			      const domState = readVoteState(voteBtn);
			      handleVote(action, postId, domState);
			    }, true);
			  }
			
			  // ---------- public API (names match E621_CONSTANTS.ACTIONS) ----------
			  return {
			    init: setupVoteListener,
			    backupBlacklist: () => queue.run(backupBlacklistImpl),
			    loadDownvotes: () => queue.run(loadDownvotesImpl),
			    uploadDownvotes: () => queue.run(uploadDownvotesImpl),
			    unloadDownvotes: () => queue.run(unloadDownvotesImpl),
			    syncApi: () => queue.run(syncApiImpl),
			    toggleAutoUpdate: () => queue.run(toggleAutoUpdateImpl)
			  };
			});
			// END: scripts/blacklist.js
			
			// START: scripts/uploader.js
			E621X.define('uploader', ['utils', 'selectors', 'net', 'dom'], (U, SEL, Net, D) => {
			  'use strict';
			  const { STORAGE_KEYS } = E621_CONSTANTS;
			  const ITEM_ID = 'post-info-extra-uploader';
			  const rankCache = new Map();
			
			  /* Link to a user, styled with the site's rank classes (taken from the page, the cache, or /users/:id.json). */
			  function createUserLink(id, name = '') {
			    if (!/^\d+$/.test(String(id))) return D.el('span', { text: name || 'unknown user' });
			
			    const link = D.el('a', { href: `/users/${id}`, text: name || `User #${id}` });
			    const existing = document.querySelector(`a[href="/users/${id}"]`);
			    if (existing?.className) {
			      link.className = existing.className;
			      return link;
			    }
			
			    const cached = rankCache.get(String(id));
			    if (cached) {
			      link.textContent = cached.name;
			      link.className = cached.cssClass;
			      return link;
			    }
			
			    Net.fetchJson(`/users/${id}.json`)
			      .then(user => {
			        const level = String(user.level_string || 'member').toLowerCase().replace(/[^a-z0-9_-]/g, '');
			        const cssClass = user.is_banned ? 'user-blocked' : `user-${level}`;
			        rankCache.set(String(id), { name: user.name, cssClass });
			        link.textContent = user.name;
			        link.className = cssClass;
			      })
			      .catch(err => U.logWarn('uploader rank lookup', err));
			
			    return link;
			  }
			
			  const findInfoItem = (prefix, excludeId = null) =>
			    Array.from(document.querySelectorAll(SEL.postInfoItems)).find(li =>
			      li.id !== excludeId && li.textContent.trim().toLowerCase().startsWith(prefix));
			
			  function updateVisibility(enabled) {
			    const existing = document.getElementById(ITEM_ID);
			    if (!enabled) { existing?.remove(); return; }
			
			    // The site may already render a native "Uploader:" row
			    if (findInfoItem('uploader:', ITEM_ID)) { existing?.remove(); return; }
			    if (existing) return;
			
			    const container = document.querySelector(SEL.imageContainer);
			    const uploaderId = container?.dataset.uploaderId;
			    if (!uploaderId) return;
			
			    const li = D.el('li', { id: ITEM_ID }, [
			      'Uploader: ',
			      createUserLink(uploaderId, container.dataset.uploader || '')
			    ]);
			
			    const postedLi = findInfoItem('posted:');
			    if (postedLi) {
			      postedLi.insertAdjacentElement('afterend', li);
			    } else {
			      const lists = document.querySelectorAll(SEL.postInfoLists);
			      lists[lists.length - 1]?.appendChild(li);
			    }
			  }
			
			  async function init() {
			    updateVisibility(await U.storageGet(STORAGE_KEYS.SHOW_UPLOADER, true));
			    chrome.storage.onChanged.addListener((changes, area) => {
			      if (area === 'local' && changes[STORAGE_KEYS.SHOW_UPLOADER]) {
			        updateVisibility(changes[STORAGE_KEYS.SHOW_UPLOADER].newValue !== false);
			      }
			    });
			  }
			
			  return { init, updateVisibility };
			});
			// END: scripts/uploader.js
			
			// START: scripts/user_edits.js
			/* User Profile: Specific Post Edits filter & Tag Update Statistics dashboard.
			 * - Allows filtering post versions by specific tags.
			 * - Collects and visualizes comprehensive tag update statistics for any user:
			 *   most added tags, most removed tags, most common tags in edited posts, timeline dates,
			 *   with full category coloring matching e621 conventions. */
			E621X.define('userEdits', ['utils', 'selectors', 'net', 'dom'], (U, SEL, Net, D) => {
			  'use strict';
			
			  const STORAGE_KEY_PREFIX = 'e621x_specific_edits_';
			  const FORM_CONTAINER_ID = 'e621x-specific-edits-container';
			  const STATS_MODAL_ID = 'e621x-tag-stats-modal';
			
			  const CATEGORY_NAMES = {
			    0: 'General',
			    1: 'Artist',
			    2: 'Contributor',
			    3: 'Copyright',
			    4: 'Character',
			    5: 'Species',
			    6: 'Invalid',
			    7: 'Meta',
			    8: 'Lore'
			  };
			
			  const tagCategoryCache = new Map();
			  const inFlightCategories = new Set();
			  const userStatsCache = new Map(); // userId -> { statsMap, totalVersions, uniquePosts }
			
			  let isCounting = false;
			
			  function isUserPage() {
			    return /^\/users\/\d+/i.test(location.pathname) ||
			      (document.body?.classList?.contains('c-users') && document.body?.classList?.contains('a-show'));
			  }
			
			  function getProfileUserId() {
			    const match = location.pathname.match(/^\/users\/(\d+)/i);
			    if (match) return match[1];
			
			    const cardLink = document.querySelector('.user-card-name a[href*="/users/"]');
			    if (cardLink) {
			      const m = cardLink.href.match(/\/users\/(\d+)/);
			      if (m) return m[1];
			    }
			
			    const meta = document.querySelector('meta[name="user-id"]');
			    if (meta?.content && /^\d+$/.test(meta.content)) return meta.content;
			
			    const link = document.querySelector('a[href*="/post_versions?"]');
			    if (link) {
			      const m = link.href.match(/search(?:\[|%5B)updater_id(?:\]|%5D)=(\d+)/);
			      if (m) return m[1];
			    }
			
			    return null;
			  }
			
			  /* Takes the username directly from .user-card-name of the profile being viewed */
			  function getProfileUserName() {
			    const cardLink = document.querySelector('.user-card-name a, .user-card-name');
			    if (cardLink) {
			      const name = cardLink.textContent.trim();
			      if (name) return name;
			    }
			
			    const ogTitle = document.querySelector('meta[property="og:title"]');
			    if (ogTitle?.content) {
			      const clean = ogTitle.content.replace(/\s*-\s*e621.*$/i, '').trim();
			      if (clean) return clean;
			    }
			
			    const titleMatch = document.title.match(/User\s*-\s*(.+?)\s*-\s*e621/i);
			    if (titleMatch?.[1]) {
			      return titleMatch[1].trim();
			    }
			
			    const userId = getProfileUserId();
			    return userId ? `User #${userId}` : 'User';
			  }
			
			  /* Reads the exact number of post edits from the profile Changes block (e.g. <h5>4652</h5>) */
			  function getProfilePostEditsCount() {
			    const postVersionLink = document.querySelector('a[href*="/post_versions"][href*="updater_id"], a[href*="/post_versions"]');
			    if (postVersionLink) {
			      const h5 = postVersionLink.querySelector('h5');
			      if (h5) {
			        const num = parseInt(h5.textContent.replace(/[^\d]/g, ''), 10);
			        if (Number.isFinite(num) && num > 0) return num;
			      }
			      const rawNum = parseInt(postVersionLink.textContent.replace(/[^\d]/g, ''), 10);
			      if (Number.isFinite(rawNum) && rawNum > 0) return rawNum;
			    }
			
			    const changesLines = document.querySelectorAll('.profile-line');
			    for (const line of changesLines) {
			      const text = line.textContent || '';
			      if (text.includes('Changes') || text.includes('Post')) {
			        const link = line.querySelector('a[href*="/post_versions"]');
			        if (link) {
			          const num = parseInt(link.textContent.replace(/[^\d]/g, ''), 10);
			          if (Number.isFinite(num) && num > 0) return num;
			        }
			      }
			    }
			
			    return 0;
			  }
			
			  function seedCategoryCache() {
			    document.querySelectorAll('#tag-list li[class*="tag-type-"]').forEach(li => {
			      const match = li.className.match(/tag-type-(\d+)/);
			      const tagLink = li.querySelector('a.search-tag, a');
			      if (match && tagLink) {
			        const cat = Number(match[1]);
			        const name = tagLink.textContent.trim().toLowerCase().replace(/\s+/g, '_');
			        if (name) tagCategoryCache.set(name, cat);
			      }
			    });
			  }
			
			  async function fetchMissingCategories(tagNames) {
			    const missing = tagNames.filter(t => !tagCategoryCache.has(t) && !inFlightCategories.has(t));
			    if (!missing.length) return;
			
			    missing.forEach(t => inFlightCategories.add(t));
			    for (let i = 0; i < missing.length; i += 100) {
			      const chunk = missing.slice(i, i + 100);
			      try {
			        const url = `/tags.json?search[name]=${encodeURIComponent(chunk.join(','))}&limit=100`;
			        const data = await Net.fetchJson(url);
			        const list = Array.isArray(data) ? data : (data?.tags || []);
			        list.forEach(t => {
			          if (t?.name && t.category !== undefined) {
			            tagCategoryCache.set(String(t.name).toLowerCase(), Number(t.category));
			          }
			        });
			        chunk.forEach(t => {
			          if (!tagCategoryCache.has(t)) tagCategoryCache.set(t, 0);
			        });
			      } catch (err) {
			        U.logWarn('fetchMissingCategories', err);
			        chunk.forEach(t => {
			          if (!tagCategoryCache.has(t)) tagCategoryCache.set(t, 0);
			        });
			      } finally {
			        chunk.forEach(t => inFlightCategories.delete(t));
			      }
			    }
			  }
			
			  function extractTags(val) {
			    if (!val) return [];
			    if (Array.isArray(val)) return val.map(t => String(t).trim().toLowerCase()).filter(Boolean);
			    if (typeof val === 'string') return val.trim().toLowerCase().split(/\s+/).filter(Boolean);
			    return [];
			  }
			
			  function formatShortDate(timestamp) {
			    if (!timestamp) return '—';
			    const d = new Date(timestamp);
			    if (isNaN(d.getTime())) return '—';
			    const pad = n => String(n).padStart(2, '0');
			    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
			  }
			
			  // ==========================================
			  // TAG UPDATE STATISTICS MODAL
			  // ==========================================
			  function openTagStatsModal(userId) {
			    const existing = document.getElementById(STATS_MODAL_ID);
			    if (existing) existing.remove();
			
			    const userName = getProfileUserName();
			    const expectedTotal = getProfilePostEditsCount();
			    let abortFetch = false;
			
			    // Active filters & sorting
			    let sortKey = 'added_desc';
			    let filterCategory = 'all';
			    let filterAction = 'all';
			    let filterUploadType = 'all';
			    let filterQuery = '';
			    let currentPage = 1;
			    const PAGE_SIZE = 50;
			
			    // Elements
			    const overlay = D.el('div', { id: STATS_MODAL_ID, class: 'e621x-stats-overlay' });
			    const dialog = D.el('div', { class: 'e621x-stats-dialog', role: 'dialog', 'aria-modal': 'true' });
			
			    // 1. Header
			    const titleSpan = D.el('span', { class: 'e621x-stats-title', text: `Tag Update Statistics — ${userName} (#${userId})` });
			    function closeModal() {
			      abortFetch = true;
			      document.removeEventListener('keydown', handleKeydown);
			      overlay.remove();
			    }
			
			    const closeBtn = D.el('button', {
			      type: 'button',
			      class: 'e621x-stats-close-btn',
			      text: '×',
			      'aria-label': 'Close',
			      onClick: closeModal
			    });
			
			    const header = D.el('div', { class: 'e621x-stats-header' }, [
			      titleSpan,
			      closeBtn
			    ]);
			
			    // 2. Fetch Progress Area
			    const progressText = D.el('div', { class: 'e621x-stats-progress-text', text: 'Preparing to fetch updates...' });
			    const progressBar = D.el('div', { class: 'e621x-stats-progress-fill' });
			    const progressTrack = D.el('div', { class: 'e621x-stats-progress-track' }, [progressBar]);
			
			    const btnStopView = D.button({
			      text: 'Stop & View',
			      title: 'Stop loading more edits and view collected stats',
			      className: 'e621x-stats-btn',
			      onClick: () => {
			        abortFetch = true;
			        progressText.textContent = 'Stopping and displaying collected stats...';
			      }
			    });
			
			    const btnCancel = D.button({
			      text: 'Cancel',
			      className: 'e621x-stats-btn',
			      onClick: closeModal
			    });
			
			    const progressBox = D.el('div', { class: 'e621x-stats-progress-box' }, [
			      progressText,
			      progressTrack,
			      D.el('div', { class: 'e621x-stats-progress-actions' }, [btnStopView, btnCancel])
			    ]);
			
			    // 3. Summary Cards
			    const summaryCardVersions = D.el('div', { class: 'e621x-stats-summary-card' }, [
			      D.el('span', { class: 'e621x-stats-summary-num', text: '0' }),
			      D.el('span', { class: 'e621x-stats-summary-lbl', text: 'Total Versions' })
			    ]);
			    const summaryCardPosts = D.el('div', { class: 'e621x-stats-summary-card' }, [
			      D.el('span', { class: 'e621x-stats-summary-num', text: '0' }),
			      D.el('span', { class: 'e621x-stats-summary-lbl', text: 'Unique Posts' })
			    ]);
			    const summaryCardAdded = D.el('div', { class: 'e621x-stats-summary-card' }, [
			      D.el('span', { class: 'e621x-stats-summary-num e621x-color-add', text: '0' }),
			      D.el('span', { class: 'e621x-stats-summary-lbl', text: 'Tags Added' })
			    ]);
			    const summaryCardRemoved = D.el('div', { class: 'e621x-stats-summary-card' }, [
			      D.el('span', { class: 'e621x-stats-summary-num e621x-color-rem', text: '0' }),
			      D.el('span', { class: 'e621x-stats-summary-lbl', text: 'Tags Removed' })
			    ]);
			    const summaryCardPool = D.el('div', { class: 'e621x-stats-summary-card' }, [
			      D.el('span', { class: 'e621x-stats-summary-num', text: '0' }),
			      D.el('span', { class: 'e621x-stats-summary-lbl', text: 'Tags in Posts' })
			    ]);
			
			    const summaryBar = D.el('div', { class: 'e621x-stats-summary-bar hidden', style: 'display: none;' }, [
			      summaryCardVersions,
			      summaryCardPosts,
			      summaryCardAdded,
			      summaryCardRemoved,
			      summaryCardPool
			    ]);
			
			    // 4. Controls Toolbar
			    const inputSearch = D.el('input', {
			      type: 'text',
			      class: 'st-input e621x-stats-search',
			      placeholder: 'Filter tags by name...',
			      autocomplete: 'off'
			    });
			
			    const selectSort = D.el('select', { class: 'st-select e621x-stats-select' }, [
			      D.el('option', { value: 'added_desc', text: 'Sort by: Most Added (↓)' }),
			      D.el('option', { value: 'added_asc', text: 'Sort by: Least Added (↑)' }),
			      D.el('option', { value: 'removed_desc', text: 'Sort by: Most Removed (↓)' }),
			      D.el('option', { value: 'removed_asc', text: 'Sort by: Least Removed (↑)' }),
			      D.el('option', { value: 'posts_desc', text: 'Sort by: Most in Posts (↓)' }),
			      D.el('option', { value: 'date_desc', text: 'Sort by: Date (Most Recent)' }),
			      D.el('option', { value: 'date_asc', text: 'Sort by: Date (Oldest First)' }),
			      D.el('option', { value: 'name_asc', text: 'Sort by: Name (A-Z)' })
			    ]);
			
			    const selectAction = D.el('select', { class: 'st-select e621x-stats-select' }, [
			      D.el('option', { value: 'all', text: 'All Tag Changes' }),
			      D.el('option', { value: 'added_only', text: 'Added Only (>0)' }),
			      D.el('option', { value: 'added_or_removed', text: 'Added or Removed (>0)' }),
			      D.el('option', { value: 'removed_only', text: 'Removed Only (>0)' }),
			      D.el('option', { value: 'both', text: 'Both Added & Removed' })
			    ]);
			
			    const selectUploadType = D.el('select', { class: 'st-select e621x-stats-select' }, [
			      D.el('option', { value: 'all', text: 'All (Uploads & Edits)' }),
			      D.el('option', { value: 'uploads_only', text: 'Uploads Only' }),
			      D.el('option', { value: 'non_uploads', text: 'Non-Uploads Only' })
			    ]);
			
			    const selectCat = D.el('select', { class: 'st-select e621x-stats-select' }, [
			      D.el('option', { value: 'all', text: 'All Categories' }),
			      ...Object.entries(CATEGORY_NAMES).map(([val, label]) =>
			        D.el('option', { value: val, text: label }))
			    ]);
			
			    const btnExportCsv = D.button({
			      text: 'Export CSV',
			      className: 'e621x-stats-btn',
			      title: 'Download tag statistics as CSV'
			    });
			
			    const btnRefresh = D.button({
			      text: 'Re-fetch',
			      className: 'e621x-stats-btn',
			      title: 'Clear cache and re-fetch all versions from API'
			    });
			
			    const toolbar = D.el('div', { class: 'e621x-stats-toolbar hidden', style: 'display: none;' }, [
			      D.el('div', { class: 'e621x-stats-toolbar-group' }, [
			        inputSearch,
			        selectSort,
			        selectAction,
			        selectUploadType,
			        selectCat
			      ]),
			      D.el('div', { class: 'e621x-stats-toolbar-group' }, [
			        btnExportCsv,
			        btnRefresh
			      ])
			    ]);
			
			    // 5. Table Container
			    const tableBody = D.el('tbody');
			    const table = D.el('table', { class: 'e621x-stats-table' }, [
			      D.el('thead', {}, [
			        D.el('tr', {}, [
			          D.el('th', { style: 'width: 32%', text: 'Tag' }),
			          D.el('th', { style: 'width: 14%', text: 'Category' }),
			          D.el('th', { style: 'width: 13%', text: 'Times Added' }),
			          D.el('th', { style: 'width: 13%', text: 'Times Removed' }),
			          D.el('th', { style: 'width: 13%', text: 'In Edited Posts' }),
			          D.el('th', { style: 'width: 15%', text: 'Last Activity' })
			        ])
			      ]),
			      tableBody
			    ]);
			
			    const tableWrap = D.el('div', { class: 'e621x-stats-table-wrap hidden', style: 'display: none;' }, [table]);
			
			    // 6. Pagination Footer
			    const pageInfo = D.el('span', { class: 'e621x-stats-page-info', text: 'Showing 0 tags' });
			    const btnPrev = D.button({ text: '« Prev', className: 'e621x-stats-btn', disabled: true });
			    const btnNext = D.button({ text: 'Next »', className: 'e621x-stats-btn', disabled: true });
			
			    const paginationBar = D.el('div', { class: 'e621x-stats-pagination hidden', style: 'display: none;' }, [
			      pageInfo,
			      D.el('div', { class: 'e621x-stats-pagination-buttons' }, [btnPrev, btnNext])
			    ]);
			
			    dialog.append(header, progressBox, summaryBar, toolbar, tableWrap, paginationBar);
			    overlay.appendChild(dialog);
			    document.body.appendChild(overlay);
			
			    // Keydown listener to close modal on Escape
			    function handleKeydown(e) {
			      if (e.key === 'Escape') {
			        closeModal();
			      }
			    }
			
			    document.addEventListener('keydown', handleKeydown);
			    let activeDataset = null;
			    let renderId = 0;
			    let isFetchingMissing = false;
			
			    async function renderActiveTable() {
			      if (!activeDataset) return;
			      const currentRenderId = ++renderId;
			
			      const {
			        statsMap,
			        totalVersions = 0,
			        uploadVersions = 0,
			        editVersions = 0,
			        uniquePosts = 0,
			        uniquePostsAll = uniquePosts,
			        uniquePostsUpload = 0,
			        uniquePostsEdit = 0
			      } = activeDataset;
			
			      // Map metrics according to the selected upload scope
			      let tags = Array.from(statsMap.values()).map(s => {
			        if (filterUploadType === 'uploads_only') {
			          return {
			            name: s.name,
			            added: s.uploadAdded || 0,
			            removed: s.uploadRemoved || 0,
			            inPosts: s.uploadInPosts || 0,
			            firstDate: s.uploadFirstDate || 0,
			            lastDate: s.uploadLastDate || 0
			          };
			        }
			        if (filterUploadType === 'non_uploads') {
			          return {
			            name: s.name,
			            added: s.editAdded || 0,
			            removed: s.editRemoved || 0,
			            inPosts: s.editInPosts || 0,
			            firstDate: s.editFirstDate || 0,
			            lastDate: s.editLastDate || 0
			          };
			        }
			        return {
			          name: s.name,
			          added: s.added || 0,
			          removed: s.removed || 0,
			          inPosts: s.inPosts || 0,
			          firstDate: s.firstDate || 0,
			          lastDate: s.lastDate || 0
			        };
			      });
			
			      // Synchronize Summary Cards with the active upload scope
			      let totalAddedCount = 0;
			      let totalRemovedCount = 0;
			      let totalInPostsCount = 0;
			
			      for (const s of tags) {
			        if (s.added > 0) totalAddedCount++;
			        if (s.removed > 0) totalRemovedCount++;
			        if (s.inPosts > 0) totalInPostsCount++;
			      }
			
			      let displayedVersions = totalVersions;
			      let displayedPosts = uniquePostsAll;
			      if (filterUploadType === 'uploads_only') {
			        displayedVersions = uploadVersions;
			        displayedPosts = uniquePostsUpload;
			      } else if (filterUploadType === 'non_uploads') {
			        displayedVersions = editVersions;
			        displayedPosts = uniquePostsEdit;
			      }
			
			      const numVersionsEl = summaryCardVersions.querySelector('.e621x-stats-summary-num');
			      if (numVersionsEl) numVersionsEl.textContent = (displayedVersions || 0).toLocaleString();
			
			      const numPostsEl = summaryCardPosts.querySelector('.e621x-stats-summary-num');
			      if (numPostsEl) numPostsEl.textContent = (displayedPosts || 0).toLocaleString();
			
			      const numAddedEl = summaryCardAdded.querySelector('.e621x-stats-summary-num');
			      if (numAddedEl) numAddedEl.textContent = totalAddedCount.toLocaleString();
			
			      const numRemovedEl = summaryCardRemoved.querySelector('.e621x-stats-summary-num');
			      if (numRemovedEl) numRemovedEl.textContent = totalRemovedCount.toLocaleString();
			
			      const numPoolEl = summaryCardPool.querySelector('.e621x-stats-summary-num');
			      if (numPoolEl) numPoolEl.textContent = totalInPostsCount.toLocaleString();
			
			      // Text Search
			      if (filterQuery) {
			        tags = tags.filter(t => t.name.includes(filterQuery));
			      }
			
			      // Action Filter
			      if (filterAction === 'added_only') {
			        tags = tags.filter(t => t.added > 0);
			      } else if (filterAction === 'added_or_removed') {
			        tags = tags.filter(t => t.added > 0 || t.removed > 0);
			      } else if (filterAction === 'removed_only') {
			        tags = tags.filter(t => t.removed > 0);
			      } else if (filterAction === 'both') {
			        tags = tags.filter(t => t.added > 0 && t.removed > 0);
			      }
			
			      // Category Filter
			      if (filterCategory !== 'all') {
			        const catNum = Number(filterCategory);
			        tags = tags.filter(t => (tagCategoryCache.get(t.name) ?? 0) === catNum);
			      }
			
			      // Sorting
			      tags.sort((a, b) => {
			        switch (sortKey) {
			          case 'added_desc':
			            return (b.added - a.added) || (b.inPosts - a.inPosts) || a.name.localeCompare(b.name);
			          case 'added_asc':
			            return (a.added - b.added) || (a.inPosts - b.inPosts) || a.name.localeCompare(b.name);
			          case 'removed_desc':
			            return (b.removed - a.removed) || (b.inPosts - a.inPosts) || a.name.localeCompare(b.name);
			          case 'removed_asc':
			            return (a.removed - b.removed) || (a.inPosts - b.inPosts) || a.name.localeCompare(b.name);
			          case 'posts_desc':
			            return (b.inPosts - a.inPosts) || (b.added - a.added) || a.name.localeCompare(b.name);
			          case 'date_desc':
			            return (b.lastDate - a.lastDate) || (b.added - a.added);
			          case 'date_asc':
			            return (a.firstDate - b.firstDate) || (a.lastDate - b.lastDate);
			          case 'name_asc':
			            return a.name.localeCompare(b.name);
			          default:
			            return 0;
			        }
			      });
			
			      const totalMatching = tags.length;
			      const totalPages = Math.max(1, Math.ceil(totalMatching / PAGE_SIZE));
			      if (currentPage > totalPages) currentPage = totalPages;
			      if (currentPage < 1) currentPage = 1;
			
			      const startIdx = (currentPage - 1) * PAGE_SIZE;
			      const pageItems = tags.slice(startIdx, startIdx + PAGE_SIZE);
			
			      // Lock pagination controls while categories are being fetched
			      btnPrev.disabled = true;
			      btnNext.disabled = true;
			
			      const visibleNames = pageItems.map(p => p.name);
			      const missing = visibleNames.filter(t => !tagCategoryCache.has(t));
			      if (missing.length > 0) {
			        isFetchingMissing = true;
			        try {
			          await fetchMissingCategories(visibleNames);
			        } finally {
			          isFetchingMissing = false;
			        }
			        // Discard stale renders triggered by fast filter or page changes
			        if (currentRenderId !== renderId) return;
			      }
			
			      tableBody.replaceChildren();
			
			      if (!pageItems.length) {
			        const emptyRow = D.el('tr', {}, [
			          D.el('td', { colspan: '6', class: 'e621x-stats-empty', text: 'No tags match the selected filters.' })
			        ]);
			        tableBody.appendChild(emptyRow);
			      } else {
			        pageItems.forEach(item => {
			          const cat = tagCategoryCache.get(item.name) ?? 0;
			          const catClass = `e621x-tag-type-${cat}`;
			          const catName = CATEGORY_NAMES[cat] || 'General';
			
			          const tagLink = D.el('a', {
			            href: `/posts?tags=${encodeURIComponent(item.name)}`,
			            target: '_blank',
			            rel: 'noopener',
			            class: `e621x-stats-tag-link ${catClass}`,
			            text: item.name
			          });
			
			          const catBadge = D.el('span', {
			            class: `e621x-cat-badge ${catClass}`,
			            text: catName
			          });
			
			          const versionParam = filterUploadType === 'uploads_only' ? '&search[version]=1' : '';
			          const addedLink = item.added > 0 ? D.el('a', {
			            href: `/post_versions?search[updater_id]=${userId}&search[tags_added]=${encodeURIComponent(item.name)}${versionParam}`,
			            target: '_blank',
			            rel: 'noopener',
			            class: 'e621x-stats-count-link e621x-color-add',
			            title: `View edits where ${userName} added ${item.name}`,
			            text: `+${item.added}`
			          }) : D.el('span', { class: 'e621x-stats-count-zero', text: '0' });
			
			          const removedLink = item.removed > 0 ? D.el('a', {
			            href: `/post_versions?search[updater_id]=${userId}&search[tags_removed]=${encodeURIComponent(item.name)}`,
			            target: '_blank',
			            rel: 'noopener',
			            class: 'e621x-stats-count-link e621x-color-rem',
			            title: `View edits where ${userName} removed ${item.name}`,
			            text: `-${item.removed}`
			          }) : D.el('span', { class: 'e621x-stats-count-zero', text: '0' });
			
			          const inPostsLink = item.inPosts > 0 ? D.el('a', {
			            href: `/post_versions?search[updater_id]=${userId}&search[tags]=${encodeURIComponent(item.name)}${versionParam}`,
			            target: '_blank',
			            rel: 'noopener',
			            class: 'e621x-stats-count-link',
			            title: `View edits on posts containing ${item.name}`,
			            text: String(item.inPosts)
			          }) : D.el('span', { class: 'e621x-stats-count-zero', text: '0' });
			
			          const row = D.el('tr', { class: 'e621x-stats-row' }, [
			            D.el('td', {}, [tagLink]),
			            D.el('td', {}, [catBadge]),
			            D.el('td', {}, [addedLink]),
			            D.el('td', {}, [removedLink]),
			            D.el('td', {}, [inPostsLink]),
			            D.el('td', { class: 'e621x-stats-date', text: formatShortDate(item.lastDate) })
			          ]);
			
			          tableBody.appendChild(row);
			        });
			      }
			
			      // Pagination status and boundaries
			      pageInfo.textContent = `Showing ${Math.min(totalMatching, startIdx + 1)}–${Math.min(totalMatching, startIdx + PAGE_SIZE)} of ${totalMatching} tags`;
			      btnPrev.disabled = currentPage <= 1;
			      btnNext.disabled = currentPage >= totalPages;
			    }
			
			    // Attach control listeners
			    inputSearch.addEventListener('input', () => {
			      filterQuery = inputSearch.value.trim().toLowerCase();
			      currentPage = 1;
			      renderActiveTable();
			    });
			
			    selectSort.addEventListener('change', () => {
			      sortKey = selectSort.value;
			      currentPage = 1;
			      renderActiveTable();
			    });
			
			    selectAction.addEventListener('change', () => {
			      filterAction = selectAction.value;
			      currentPage = 1;
			      renderActiveTable();
			    });
			
			    selectUploadType.addEventListener('change', () => {
			      filterUploadType = selectUploadType.value;
			      currentPage = 1;
			      renderActiveTable();
			    });
			
			    selectCat.addEventListener('change', () => {
			      filterCategory = selectCat.value;
			      currentPage = 1;
			      renderActiveTable();
			    });
			
			    btnPrev.addEventListener('click', () => {
			      if (isFetchingMissing) return;
			      if (currentPage > 1) {
			        currentPage--;
			        renderActiveTable();
			        tableWrap.scrollTop = 0;
			      }
			    });
			
			    btnNext.addEventListener('click', () => {
			      if (isFetchingMissing) return;
			      currentPage++;
			      renderActiveTable();
			      tableWrap.scrollTop = 0;
			    });
			
			    btnExportCsv.addEventListener('click', () => {
			      if (!activeDataset) return;
			      const rows = [
			        ['Tag', 'Category', 'Added Count', 'Removed Count', 'Posts Count', 'Last Activity Date']
			      ];
			      Array.from(activeDataset.statsMap.values()).forEach(s => {
			        let added = s.added;
			        let removed = s.removed;
			        let inPosts = s.inPosts;
			        let lastDate = s.lastDate;
			
			        if (filterUploadType === 'uploads_only') {
			          added = s.uploadAdded;
			          removed = s.uploadRemoved;
			          inPosts = s.uploadInPosts;
			          lastDate = s.uploadLastDate;
			        } else if (filterUploadType === 'non_uploads') {
			          added = s.editAdded;
			          removed = s.editRemoved;
			          inPosts = s.editInPosts;
			          lastDate = s.editLastDate;
			        }
			
			        const cat = CATEGORY_NAMES[tagCategoryCache.get(s.name) ?? 0] || 'General';
			        rows.push([
			          `"${s.name.replace(/"/g, '""')}"`,
			          `"${cat}"`,
			          added,
			          removed,
			          inPosts,
			          `"${formatShortDate(lastDate)}"`
			        ]);
			      });
			      const csvContent = rows.map(r => r.join(',')).join('\n');
			      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
			      U.downloadBlob(blob, `tag_stats_user_${userId}_${filterUploadType}_${Date.now()}.csv`);
			    });
			
			    btnRefresh.addEventListener('click', () => {
			      userStatsCache.delete(userId);
			      startFetch();
			    });
			
			    // 7. Data Fetching and Processing Engine
			    async function startFetch() {
			      if (userStatsCache.has(userId)) {
			        activeDataset = userStatsCache.get(userId);
			        finishAndDisplay();
			        return;
			      }
			
			      abortFetch = false;
			      progressBox.classList.remove('hidden');
			      progressBox.style.display = '';
			
			      summaryBar.classList.add('hidden');
			      summaryBar.style.display = 'none';
			      toolbar.classList.add('hidden');
			      toolbar.style.display = 'none';
			      tableWrap.classList.add('hidden');
			      tableWrap.style.display = 'none';
			      paginationBar.classList.add('hidden');
			      paginationBar.style.display = 'none';
			
			      const statsMap = new Map();
			      const uniquePostsAll = new Set();
			      const uniquePostsUpload = new Set();
			      const uniquePostsEdit = new Set();
			      let totalVersions = 0;
			      let uploadVersions = 0;
			      let editVersions = 0;
			      let lowestId = null;
			      let pageNum = 1;
			      const PAGE_LIMIT = 320;
			
			      const getStat = (name) => {
			        let stat = statsMap.get(name);
			        if (!stat) {
			          stat = {
			            name,
			            // Combined totals
			            added: 0,
			            removed: 0,
			            inPosts: 0,
			            postIds: new Set(),
			            firstDate: 0,
			            lastDate: 0,
			            // Uploads only (version === 1)
			            uploadAdded: 0,
			            uploadRemoved: 0,
			            uploadInPosts: 0,
			            uploadPostIds: new Set(),
			            uploadFirstDate: 0,
			            uploadLastDate: 0,
			            // Non-uploads only (version > 1)
			            editAdded: 0,
			            editRemoved: 0,
			            editInPosts: 0,
			            editPostIds: new Set(),
			            editFirstDate: 0,
			            editLastDate: 0
			          };
			          statsMap.set(name, stat);
			        }
			        return stat;
			      };
			
			      const updateProgressUi = (currentCount, currentPg) => {
			        if (expectedTotal > 0) {
			          const denominator = Math.max(expectedTotal, currentCount);
			          const pct = Math.min(100, Math.round((currentCount / denominator) * 100));
			          progressBar.style.width = `${pct}%`;
			          progressText.textContent = `Fetching post updates: ${currentCount.toLocaleString()} / ${expectedTotal.toLocaleString()} (${pct}%) — page ${currentPg}...`;
			        } else {
			          const pct = Math.min(95, currentPg * 8);
			          progressBar.style.width = `${pct}%`;
			          progressText.textContent = `Fetching post updates: ${currentCount.toLocaleString()} loaded — page ${currentPg}...`;
			        }
			      };
			
			      // Set initial progress
			      updateProgressUi(0, 1);
			
			      try {
			        while (!abortFetch) {
			          let url = `/post_versions.json?search[updater_id]=${userId}&limit=${PAGE_LIMIT}`;
			          if (lowestId !== null) {
			            url += `&page=b${lowestId}`;
			          }
			
			          const data = await Net.fetchJson(url);
			          const list = Array.isArray(data) ? data : (data?.post_versions || []);
			          if (!list.length) break;
			
			          for (const v of list) {
			            totalVersions++;
			            const postId = Number(v.post_id || v.id);
			            const isUpload = Number(v.version) === 1;
			
			            if (isUpload) {
			              uploadVersions++;
			              if (postId) uniquePostsUpload.add(postId);
			            } else {
			              editVersions++;
			              if (postId) uniquePostsEdit.add(postId);
			            }
			            if (postId) uniquePostsAll.add(postId);
			
			            const vId = Number(v.id);
			            if (vId && (lowestId === null || vId < lowestId)) {
			              lowestId = vId;
			            }
			
			            const dateStr = v.updated_at || v.created_at;
			            const time = dateStr ? new Date(dateStr).getTime() : 0;
			
			            const added = extractTags(v.added_tags || v.tags_added);
			            const removed = extractTags(v.removed_tags || v.tags_removed);
			            const inPost = extractTags(v.tags);
			
			            added.forEach(tag => {
			              const s = getStat(tag);
			              s.added++;
			              if (time > s.lastDate) s.lastDate = time;
			              if (!s.firstDate || time < s.firstDate) s.firstDate = time;
			
			              if (isUpload) {
			                s.uploadAdded++;
			                if (time > s.uploadLastDate) s.uploadLastDate = time;
			                if (!s.uploadFirstDate || time < s.uploadFirstDate) s.uploadFirstDate = time;
			              } else {
			                s.editAdded++;
			                if (time > s.editLastDate) s.editLastDate = time;
			                if (!s.editFirstDate || time < s.editFirstDate) s.editFirstDate = time;
			              }
			            });
			
			            removed.forEach(tag => {
			              const s = getStat(tag);
			              s.removed++;
			              if (time > s.lastDate) s.lastDate = time;
			              if (!s.firstDate || time < s.firstDate) s.firstDate = time;
			
			              if (isUpload) {
			                s.uploadRemoved++;
			                if (time > s.uploadLastDate) s.uploadLastDate = time;
			                if (!s.uploadFirstDate || time < s.uploadFirstDate) s.uploadFirstDate = time;
			              } else {
			                s.editRemoved++;
			                if (time > s.editLastDate) s.editLastDate = time;
			                if (!s.editFirstDate || time < s.editFirstDate) s.editFirstDate = time;
			              }
			            });
			
			            inPost.forEach(tag => {
			              const s = getStat(tag);
			              if (postId) {
			                s.postIds.add(postId);
			                if (isUpload) s.uploadPostIds.add(postId);
			                else s.editPostIds.add(postId);
			              }
			              if (time > s.lastDate) s.lastDate = time;
			              if (!s.firstDate || time < s.firstDate) s.firstDate = time;
			
			              if (isUpload) {
			                if (time > s.uploadLastDate) s.uploadLastDate = time;
			                if (!s.uploadFirstDate || time < s.uploadFirstDate) s.uploadFirstDate = time;
			              } else {
			                if (time > s.editLastDate) s.editLastDate = time;
			                if (!s.editFirstDate || time < s.editFirstDate) s.editFirstDate = time;
			              }
			            });
			          }
			
			          // Immediately update progress bar with the real loaded versions count
			          updateProgressUi(totalVersions, pageNum);
			
			          if (list.length < PAGE_LIMIT) break;
			          pageNum++;
			        }
			      } catch (err) {
			        if (!abortFetch) {
			          U.logWarn(`fetch user edits #${userId}`, err);
			          progressText.textContent = `Warning: Fetch stopped early (${err.message}). Showing loaded results.`;
			          await U.sleep(1000);
			        }
			      }
			
			      // Compute inPosts counts
			      for (const stat of statsMap.values()) {
			        stat.inPosts = stat.postIds.size;
			        stat.uploadInPosts = stat.uploadPostIds.size;
			        stat.editInPosts = stat.editPostIds.size;
			      }
			
			      activeDataset = {
			        statsMap,
			        totalVersions,
			        uploadVersions,
			        editVersions,
			        uniquePosts: uniquePostsAll.size,
			        uniquePostsAll: uniquePostsAll.size,
			        uniquePostsUpload: uniquePostsUpload.size,
			        uniquePostsEdit: uniquePostsEdit.size
			      };
			
			      userStatsCache.set(userId, activeDataset);
			      finishAndDisplay();
			    }
			
			    function finishAndDisplay() {
			      if (!activeDataset) return;
			
			      // Hide progress box and reveal dashboard
			      progressBox.classList.add('hidden');
			      progressBox.style.display = 'none';
			
			      summaryBar.classList.remove('hidden');
			      summaryBar.style.display = '';
			      toolbar.classList.remove('hidden');
			      toolbar.style.display = '';
			      tableWrap.classList.remove('hidden');
			      tableWrap.style.display = '';
			      paginationBar.classList.remove('hidden');
			      paginationBar.style.display = '';
			
			      renderActiveTable();
			    }
			
			    startFetch();
			  }
			
			  // ==========================================
			  // SPECIFIC POST EDITS FILTER (EXISTING)
			  // ==========================================
			  function loadSavedQuery(userId) {
			    try {
			      const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${userId}`) ||
			                  localStorage.getItem(`${STORAGE_KEY_PREFIX}last`);
			      return raw ? JSON.parse(raw) : null;
			    } catch (_) {
			      return null;
			    }
			  }
			
			  function saveQuery(userId, query) {
			    try {
			      const json = JSON.stringify(query);
			      localStorage.setItem(`${STORAGE_KEY_PREFIX}${userId}`, json);
			      localStorage.setItem(`${STORAGE_KEY_PREFIX}last`, json);
			    } catch (_) {
			      // localStorage disabled or full
			    }
			  }
			
			  function clearSavedQuery(userId) {
			    try {
			      localStorage.removeItem(`${STORAGE_KEY_PREFIX}${userId}`);
			    } catch (_) {
			      // Ignored
			    }
			  }
			
			  function buildUrl(userId, { tags, added, removed }, isJson = false) {
			    const endpoint = isJson ? '/post_versions.json' : '/post_versions';
			    const params = new URLSearchParams();
			
			    if (userId) {
			      params.set('search[updater_id]', userId);
			    }
			    if (tags?.trim()) {
			      params.set('search[tags]', tags.trim());
			    }
			    if (added?.trim()) {
			      params.set('search[tags_added]', added.trim());
			    }
			    if (removed?.trim()) {
			      params.set('search[tags_removed]', removed.trim());
			    }
			
			    return `${endpoint}?${params.toString()}`;
			  }
			
			  function createForm(userId) {
			    const container = D.el('div', {
			      id: FORM_CONTAINER_ID,
			      class: 'e621x-specific-edits-panel is-hidden'
			    });
			
			    const saved = loadSavedQuery(userId) || {};
			
			    const inputTags = D.el('input', {
			      type: 'text',
			      id: 'e621x-edits-tags',
			      class: 'st-input e621x-specific-edits-input',
			      placeholder: '(use space for AND matches)',
			      value: saved.tags || '',
			      autocomplete: 'off'
			    });
			
			    const inputAdded = D.el('input', {
			      type: 'text',
			      id: 'e621x-edits-added',
			      class: 'st-input e621x-specific-edits-input',
			      placeholder: '(use ~ for OR matches)',
			      value: saved.added || '',
			      autocomplete: 'off'
			    });
			
			    const inputRemoved = D.el('input', {
			      type: 'text',
			      id: 'e621x-edits-removed',
			      class: 'st-input e621x-specific-edits-input',
			      placeholder: '(use - to exclude tags)',
			      value: saved.removed || '',
			      autocomplete: 'off'
			    });
			
			    function removeStatus() {
			      const existing = container.querySelector('.e621x-specific-edits-status');
			      if (existing) existing.remove();
			    }
			
			    function showStatus(children, isError = false) {
			      removeStatus();
			      const status = D.el('div', {
			        class: `e621x-specific-edits-status${isError ? ' is-error' : ''}`
			      }, children);
			      container.appendChild(status);
			      return status;
			    }
			
			    function getValues() {
			      return {
			        tags: inputTags.value.trim(),
			        added: inputAdded.value.trim(),
			        removed: inputRemoved.value.trim()
			      };
			    }
			
			    function handleNavigate() {
			      const q = getValues();
			      if (!q.tags && !q.added && !q.removed) {
			        showStatus('Enter at least one tag filter (in post, added, or removed).', true);
			        return;
			      }
			      saveQuery(userId, q);
			      const url = buildUrl(userId, q, false);
			      window.open(url, '_blank', 'noopener');
			    }
			
			    async function handleCount() {
			      if (isCounting) return;
			
			      const q = getValues();
			      if (!q.tags && !q.added && !q.removed) {
			        showStatus('Enter at least one tag filter to count edits.', true);
			        return;
			      }
			
			      saveQuery(userId, q);
			      isCounting = true;
			      btnCount.style.cursor = 'wait';
			      showStatus('Counting edits...');
			
			      try {
			        let total = 0;
			        let page = 1;
			        const PAGE_LIMIT = 320;
			        const MAX_PAGES = 100;
			
			        while (page <= MAX_PAGES && isCounting) {
			          const statusEl = container.querySelector('.e621x-specific-edits-status');
			          if (statusEl) {
			            statusEl.textContent = total > 0
			              ? `Counting edits: ${total}... (page ${page})`
			              : `Counting edits... (page ${page})`;
			          }
			
			          const url = `${buildUrl(userId, q, true)}&limit=${PAGE_LIMIT}&page=${page}`;
			          const data = await Net.fetchJson(url);
			          const list = Array.isArray(data) ? data : (data?.post_versions || []);
			          total += list.length;
			
			          if (list.length < PAGE_LIMIT) break;
			          page++;
			        }
			
			        if (!isCounting) return;
			
			        const viewUrl = buildUrl(userId, q, false);
			        const limitText = page > MAX_PAGES ? '+' : '';
			
			        showStatus([
			          document.createTextNode(`Found ${total}${limitText} edit(s) by User #${userId}. `),
			          D.el('a', {
			            href: viewUrl,
			            target: '_blank',
			            rel: 'noopener',
			            text: '[View Edits]'
			          })
			        ]);
			      } catch (err) {
			        if (isCounting) {
			          showStatus(`Error counting edits: ${err.message}`, true);
			        }
			      } finally {
			        isCounting = false;
			        btnCount.style.cursor = '';
			      }
			    }
			
			    function handleClear() {
			      isCounting = false;
			      btnCount.style.cursor = '';
			      inputTags.value = '';
			      inputAdded.value = '';
			      inputRemoved.value = '';
			      clearSavedQuery(userId);
			      removeStatus();
			    }
			
			    [inputTags, inputAdded, inputRemoved].forEach(input => {
			      input.addEventListener('keydown', (e) => {
			        if (e.key === 'Enter') {
			          e.preventDefault();
			          handleNavigate();
			        }
			      });
			    });
			
			    const btnView = D.button({
			      text: 'View',
			      title: 'Open post versions in a new tab',
			      className: 'e621x-specific-edits-btn',
			      onClick: handleNavigate
			    });
			
			    const btnCount = D.button({
			      text: 'Count',
			      title: 'Count edits matching these tags via API',
			      className: 'e621x-specific-edits-btn',
			      onClick: handleCount
			    });
			
			    const btnClear = D.button({
			      text: 'Clear',
			      title: 'Clear all fields and remove results',
			      className: 'e621x-specific-edits-btn',
			      onClick: handleClear
			    });
			
			    const closeBtn = D.el('button', {
			      type: 'button',
			      class: 'e621x-specific-edits-close',
			      text: '×',
			      title: 'Close',
			      onClick: () => {
			        isCounting = false;
			        btnCount.style.cursor = '';
			        container.classList.add('is-hidden');
			      }
			    });
			
			    const header = D.el('div', { class: 'e621x-specific-edits-header' }, [
			      D.el('span', { class: 'e621x-specific-edits-title', text: `Specific Post Edits (User #${userId})` }),
			      closeBtn
			    ]);
			
			    const fields = D.el('div', { class: 'e621x-specific-edits-fields' }, [
			      D.el('div', { class: 'e621x-specific-edits-field' }, [
			        D.el('label', { for: 'e621x-edits-tags', text: 'Tags in post' }),
			        inputTags
			      ]),
			      D.el('div', { class: 'e621x-specific-edits-field' }, [
			        D.el('label', { for: 'e621x-edits-added', text: 'Tags added' }),
			        inputAdded
			      ]),
			      D.el('div', { class: 'e621x-specific-edits-field' }, [
			        D.el('label', { for: 'e621x-edits-removed', text: 'Tags removed' }),
			        inputRemoved
			      ])
			    ]);
			
			    const actions = D.el('div', { class: 'e621x-specific-edits-actions' }, [
			      btnView,
			      btnCount,
			      btnClear
			    ]);
			
			    container.append(header, fields, actions);
			    return container;
			  }
			
			  function toggleForm(form) {
			    const isHidden = form.classList.toggle('is-hidden');
			    if (!isHidden) {
			      const statsTabBtn = document.querySelector('tabs-menu button[name="stats"]');
			      if (statsTabBtn && !statsTabBtn.classList.contains('active')) {
			        statsTabBtn.click();
			      }
			      form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
			      form.querySelector('input')?.focus();
			    }
			  }
			
			  function inject() {
			    if (!isUserPage()) return;
			    seedCategoryCache();
			
			    const userId = getProfileUserId();
			    if (!userId) return;
			
			    if (document.getElementById(FORM_CONTAINER_ID)) return;
			
			    const form = createForm(userId);
			    const postVersionLink = document.querySelector('a[href*="/post_versions"]');
			    const changesLine = postVersionLink?.closest('.profile-line');
			
			    if (changesLine) {
			      const triggerForm = D.el('a', {
			        role: 'button',
			        class: 'e621x-specific-edits-trigger',
			        text: 'view specific post edits',
			        onClick: (e) => {
			          e.preventDefault();
			          toggleForm(form);
			        }
			      });
			
			      const triggerStats = D.el('a', {
			        role: 'button',
			        class: 'e621x-specific-edits-trigger',
			        text: 'view tag update statistics',
			        onClick: (e) => {
			          e.preventDefault();
			          openTagStatsModal(userId);
			        }
			      });
			
			      const sep = D.el('span', { class: 'e621x-trigger-sep', text: '·' });
			
			      const triggersRow = D.el('div', { class: 'e621x-specific-edits-triggers-row' }, [
			        triggerForm,
			        sep,
			        triggerStats
			      ]);
			
			      const wrapper = D.el('div', { class: 'e621x-specific-edits-wrapper' }, [
			        triggersRow,
			        form
			      ]);
			      changesLine.appendChild(wrapper);
			    }
			  }
			
			  return { init: inject, openTagStatsModal };
			});
			// END: scripts/user_edits.js
			
			// START: scripts/tree/data.js
			E621X.define('treeData', ['net'], (Net) => {
			  'use strict';
			  const IDS_PER_REQUEST = 100;
			  const PARENT_SEARCH_LIMIT = 320;
			
			  const unwrapPost = (data) => data.post || data;
			  const unwrapList = (data) => (Array.isArray(data) ? data : (data.posts || []));
			
			  const fetchPost = async (id) => unwrapPost(await Net.fetchJson(`/posts/${id}.json`));
			
			  async function fetchByIds(ids) {
			    const found = [];
			    for (let i = 0; i < ids.length; i += IDS_PER_REQUEST) {
			      const chunk = ids.slice(i, i + IDS_PER_REQUEST);
			      found.push(...unwrapList(await Net.fetchJson(`/posts.json?tags=id:${chunk.join(',')}&limit=${IDS_PER_REQUEST}`)));
			    }
			    return found;
			  }
			
			  const fetchByParent = async (parentId) =>
			    unwrapList(await Net.fetchJson(`/posts.json?tags=parent:${parentId}&limit=${PARENT_SEARCH_LIMIT}`));
			
			  /* Walks up to the root, then down breadth-first.
			   * Partial failures do not abort the tree; they are reported in `warnings`. */
			  async function fetchFullTree(startPostId) {
			    const warnings = [];
			
			    let root;
			    try {
			      root = await fetchPost(startPostId);
			    } catch (err) {
			      throw new Error(`Post #${startPostId} not found (${err.message})`);
			    }
			
			    const visitedUp = new Set([root.id]);
			    while (root.relationships?.parent_id) {
			      const parentId = root.relationships.parent_id;
			      if (visitedUp.has(parentId)) break;
			      visitedUp.add(parentId);
			      try {
			        root = await fetchPost(parentId);
			      } catch (err) {
			        warnings.push(`parent #${parentId}: ${err.message}`);
			        break;
			      }
			    }
			
			    const postsMap = new Map([[root.id, root]]);
			    const seen = new Set([root.id]);
			    const queue = [root];
			
			    while (queue.length) {
			      const current = queue.shift();
			      if (!current.relationships?.has_children) continue;
			
			      const declared = current.relationships.children || [];
			      const idsToFetch = declared.filter(id => !seen.has(id));
			      idsToFetch.forEach(id => seen.add(id));
			
			      let fetched = [];
			      try {
			        if (declared.length) {
			          fetched = idsToFetch.length ? await fetchByIds(idsToFetch) : [];
			        } else {
			          fetched = await fetchByParent(current.id);
			        }
			      } catch (err) {
			        warnings.push(`children of #${current.id}: ${err.message}`);
			      }
			
			      for (const post of fetched) {
			        if (postsMap.has(post.id)) continue;
			        seen.add(post.id);
			        postsMap.set(post.id, post);
			        queue.push(post);
			      }
			    }
			
			    return { rootId: root.id, postsMap, warnings };
			  }
			
			  function buildHierarchy(rootId, postsMap) {
			    const nodes = new Map();
			    for (const [id, post] of postsMap) nodes.set(id, { post, children: [] });
			
			    const root = nodes.get(rootId);
			    if (!root) return null;
			
			    for (const [id, node] of nodes) {
			      if (id === rootId) continue;
			      const parentId = node.post.relationships?.parent_id;
			      (parentId && nodes.has(parentId) ? nodes.get(parentId) : root).children.push(node);
			    }
			
			    const sortSubtree = (n) => {
			      n.children.sort((a, b) => a.post.id - b.post.id);
			      n.children.forEach(sortSubtree);
			    };
			    sortSubtree(root);
			    return root;
			  }
			
			  return { fetchFullTree, buildHierarchy, fetchByIds };
			
			});
			// END: scripts/tree/data.js
			
			// START: scripts/tree/export.js
			E621X.define('treeExport', ['utils', 'dom'], (U, D) => {
			  'use strict';
			  const { ACTIONS } = E621_CONSTANTS;
			  const esc = D.escapeHtml;
			
			  const IMAGE_CONCURRENCY = 6;
			  const PADDING = 40;
			  const PIN_OFFSET = 16;
			  const DESC_HEIGHT = 28;
			  const RATING_COLORS = { E: '#e45f5f', Q: '#e4a15f', S: '#5fe476' };
			
			  function exportTreeToJson(rootNode, postsMap, rootId) {
			    const serialize = (n) => ({
			      id: n.post.id,
			      rating: n.post.rating,
			      score: n.post.score?.total || 0,
			      fav_count: n.post.fav_count || 0,
			      comment_count: n.post.comment_count || 0,
			      tags: n.post.tags,
			      file: n.post.file,
			      preview: n.post.preview,
			      relationships: n.post.relationships,
			      children: n.children.map(serialize)
			    });
			    const data = {
			      rootId,
			      exportedAt: new Date().toISOString(),
			      totalPosts: postsMap.size,
			      tree: serialize(rootNode)
			    };
			    U.downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `e621_post_tree_${rootId}.json`);
			    U.showToast(`Exported JSON for Tree #${rootId}`);
			  }
			
			  /* Image bytes are fetched by the background worker: a content-script fetch is bound by the page's CORS. */
			  async function fetchImageAsDataUrl(url) {
			    try {
			      const res = await chrome.runtime.sendMessage({ action: ACTIONS.FETCH_IMAGE, url });
			      if (res?.ok) return res.dataUrl;
			      U.logWarn('image fetch', res?.error);
			    } catch (err) {
			      U.logWarn('image fetch', err);
			    }
			    return null;
			  }
			
			  async function embedImages(renderedCards) {
			    const images = new Map();
			    await U.mapLimit(renderedCards, IMAGE_CONCURRENCY, async ({ post, card }) => {
			      const url = card.dataset.previewUrl;
			      if (url) images.set(post.id, await fetchImageAsDataUrl(url));
			    });
			    return images;
			  }
			
			  const relativeRect = (element, containerRect) => {
			    const r = element.getBoundingClientRect();
			    return { x: r.left - containerRect.left, y: r.top - containerRect.top, w: r.width, h: r.height };
			  };
			
			  function renderConnection(from, to) {
			    const x1 = from.x + from.w / 2;
			    const y1 = from.y + from.h + PIN_OFFSET;
			    const x2 = to.x + to.w / 2;
			    const y2 = to.y - PIN_OFFSET;
			    const midY = (y1 + y2) / 2;
			    return `  <path class="tree-line" d="M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}" />\n`;
			  }
			
			  function renderCard({ post, gen, hasParent, hasChildren }, rect, imageHref, preserveAspect) {
			    const { x, y, w, h } = rect;
			    const imgH = h - DESC_HEIGHT;
			    const score = post.score?.total || 0;
			    const rating = (post.rating || 's').toUpperCase();
			    const ratingColor = RATING_COLORS[rating] || RATING_COLORS.S;
			    const postUrl = U.siteUrl(`/posts/${post.id}`);
			
			    let svg = `  <g id="card-${post.id}">\n`;
			    svg += `    <a href="${esc(postUrl)}" target="_blank">\n`;
			    svg += `      <rect class="tree-card-bg" x="${x}" y="${y}" width="${w}" height="${h}" rx="4" />\n`;
			    if (imageHref) {
			      svg += `      <image href="${esc(imageHref)}" x="${x}" y="${y}" width="${w}" height="${imgH}" preserveAspectRatio="${preserveAspect}" />\n`;
			    }
			    svg += `      <rect class="tree-desc-bg" x="${x}" y="${y + imgH}" width="${w}" height="${DESC_HEIGHT}" />\n`;
			    svg += `      <text class="tree-text" x="${x + 8}" y="${y + imgH + 18}" font-size="11">▲ ${score}  ★ ${post.fav_count || 0}</text>\n`;
			    svg += `      <rect x="${x + w - 22}" y="${y + imgH + 6}" width="16" height="16" rx="2" fill="${ratingColor}" />\n`;
			    svg += `      <text x="${x + w - 14}" y="${y + imgH + 18}" font-size="10" font-weight="bold" fill="#000" text-anchor="middle">${esc(rating)}</text>\n`;
			    svg += `    </a>\n`;
			    if (hasParent) {
			      svg += `    <circle class="tree-pin-bg" cx="${x + w / 2}" cy="${y - 7}" r="9" />\n`;
			      svg += `    <text class="tree-pin-text" x="${x + w / 2}" y="${y - 7}">${gen}</text>\n`;
			    }
			    if (hasChildren) {
			      svg += `    <circle class="tree-pin-bg" cx="${x + w / 2}" cy="${y + h + 7}" r="9" />\n`;
			      svg += `    <text class="tree-pin-text" x="${x + w / 2}" y="${y + h + 7}">${gen}</text>\n`;
			    }
			    return svg + `  </g>\n`;
			  }
			
			  const SVG_STYLE = `<style>
			      .tree-card-bg { fill: #152f56; stroke: #2a4c7e; stroke-width: 1; }
			      .tree-desc-bg { fill: #0a1b32; }
			      .tree-text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; fill: #ffffff; }
			      .tree-line { stroke: rgba(255, 255, 255, 0.4); stroke-width: 1.5; fill: none; }
			      .tree-pin-bg { fill: #152f56; stroke: #3b6aa0; stroke-width: 2; }
			      .tree-pin-text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 10px; font-weight: bold; fill: #ffffff; text-anchor: middle; dominant-baseline: central; }
			    </style>\n`;
			
			  async function exportTreeToSvg({ treeContainer, renderedCards, lineConnections, rootId, isContain }) {
			    U.showToast('Embedding images into SVG...');
			    const images = await embedImages(renderedCards);
			
			    const containerRect = treeContainer.getBoundingClientRect();
			    const rects = new Map(renderedCards.map(c => [c.card, relativeRect(c.card, containerRect)]));
			
			    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
			    for (const r of rects.values()) {
			      minX = Math.min(minX, r.x);
			      minY = Math.min(minY, r.y - 18);
			      maxX = Math.max(maxX, r.x + r.w);
			      maxY = Math.max(maxY, r.y + r.h + 18);
			    }
			    const vbX = Math.floor(minX - PADDING);
			    const vbY = Math.floor(minY - PADDING);
			    const vbW = Math.ceil(maxX - minX + PADDING * 2);
			    const vbH = Math.ceil(maxY - minY + PADDING * 2);
			
			    let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`;
			    svg += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="${vbW}" height="${vbH}">\n`;
			    svg += SVG_STYLE;
			    svg += `<rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="#0a1322" />\n`;
			
			    svg += `<g id="connections">\n`;
			    for (const { fromEl, toEl } of lineConnections) {
			      svg += renderConnection(rects.get(fromEl) || relativeRect(fromEl, containerRect), rects.get(toEl) || relativeRect(toEl, containerRect));
			    }
			    svg += `</g>\n<g id="cards">\n`;
			
			    const preserveAspect = isContain ? 'xMidYMid meet' : 'xMidYMid slice';
			    for (const entry of renderedCards) {
			      const href = images.get(entry.post.id) || entry.card.dataset.previewUrl || '';
			      svg += renderCard(entry, rects.get(entry.card), href, preserveAspect);
			    }
			    svg += `</g>\n</svg>`;
			
			    U.downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `e621_post_tree_${rootId}.svg`);
			    U.showToast(`Exported SVG for Tree #${rootId}`);
			  }
			
			  return { exportTreeToJson, exportTreeToSvg };
			});
			// END: scripts/tree/export.js
			
			// START: scripts/tree/modal.js
			E621X.define('tree',
			  ['utils', 'selectors', 'dom', 'layout', 'thumbnail', 'treeData', 'treeExport'],
			  (U, SEL, D, Layout, Thumb, TreeData, TreeExport) => {
			  'use strict';
			
			  const SVG_NS = 'http://www.w3.org/2000/svg';
			  const FIRST_DRAW_DELAY_MS = 60;
			  let closeActiveModal = null;
			
			  // ---------- building blocks ----------
			  function createModalShell(targetPostId) {
			    const titleSpan = D.el('span', { class: 'e621x-tree-title', text: `Post Tree (#${targetPostId})` });
			    const btnExportJson = D.button({ text: 'Export JSON', icon: 'download' });
			    const btnExportSvg = D.button({ text: 'Export SVG', icon: 'download' });
			    const closeBtn = D.el('button', {
			      type: 'button', class: 'e621x-tree-close st-button kinetic', text: '×', 'aria-label': 'Close'
			    });
			    const contentArea = D.el('div', { class: 'e621x-tree-content' }, [
			      D.el('div', { class: 'e621x-tree-message', text: 'Loading full dependency tree...' })
			    ]);
			    const dialog = D.el('div', { class: 'e621x-tree-dialog', role: 'dialog', 'aria-modal': 'true' }, [
			      D.el('div', { class: 'e621x-tree-titlebar' }, [
			        titleSpan,
			        D.el('div', { class: 'e621x-tree-toolbar' }, [btnExportJson, btnExportSvg, closeBtn])
			      ]),
			      contentArea
			    ]);
			    const overlay = D.el('div', { class: 'e621x-tree-overlay' });
			    return { overlay, dialog, titleSpan, btnExportJson, btnExportSvg, closeBtn, contentArea };
			  }
			
			  /* Breadth-first: tiers[i] holds generation i+1 as { node, parentNode }. */
			  function buildTiers(rootNode) {
			    const tiers = [];
			    const queue = [{ node: rootNode, parentNode: null, gen: 1 }];
			    while (queue.length) {
			      const { node, parentNode, gen } = queue.shift();
			      (tiers[gen - 1] ||= []).push({ node, parentNode });
			      node.children.forEach(child => queue.push({ node: child, parentNode: node, gen: gen + 1 }));
			    }
			    return tiers;
			  }
			
			  const createDivider = (gen, count) => D.el('div', { class: 'e621x-tree-divider' }, [
			    D.el('div', { class: 'e621x-tree-divider-line' }),
			    D.el('span', { class: 'e621x-tree-divider-label', text: `Generation ${gen} (${count})` }),
			    D.el('div', { class: 'e621x-tree-divider-line' })
			  ]);
			
			  function bindLineHighlight(card, postId, svgCanvas) {
			    const id = String(postId);
			    card.addEventListener('mouseenter', () => {
			      svgCanvas.querySelectorAll('path').forEach(p => {
			        const related = p.dataset.from === id || p.dataset.to === id;
			        p.classList.toggle('is-active', related);
			        p.classList.toggle('is-dim', !related);
			      });
			    });
			    card.addEventListener('mouseleave', () => {
			      svgCanvas.querySelectorAll('path').forEach(p => p.classList.remove('is-active', 'is-dim'));
			    });
			  }
			
			  function createLineDrawer(treeContainer, svgCanvas, lineConnections) {
			    return function drawLines() {
			      svgCanvas.replaceChildren();
			      const containerRect = treeContainer.getBoundingClientRect();
			      const width = Math.max(treeContainer.scrollWidth, treeContainer.offsetWidth);
			      const height = Math.max(treeContainer.scrollHeight, treeContainer.offsetHeight);
			      svgCanvas.setAttribute('width', width);
			      svgCanvas.setAttribute('height', height);
			
			      for (const { fromEl, toEl, fromId, toId } of lineConnections) {
			        const f = fromEl.getBoundingClientRect();
			        const t = toEl.getBoundingClientRect();
			        const x1 = f.left + f.width / 2 - containerRect.left;
			        const y1 = f.bottom - containerRect.top + 16;
			        const x2 = t.left + t.width / 2 - containerRect.left;
			        const y2 = t.top - containerRect.top - 16;
			        const midY = (y1 + y2) / 2;
			
			        const path = document.createElementNS(SVG_NS, 'path');
			        path.setAttribute('class', 'e621x-tree-line');
			        path.setAttribute('d', `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`);
			        path.dataset.from = String(fromId);
			        path.dataset.to = String(toId);
			        svgCanvas.appendChild(path);
			      }
			    };
			  }
			
			  function renderTree(shell, tree, disposer, getLayout) {
			    const { rootId, postsMap, warnings } = tree;
			    const rootNode = TreeData.buildHierarchy(rootId, postsMap);
			    if (!rootNode) throw new Error('Root post is missing');
			
			    const incomplete = warnings.length ? `, incomplete: ${warnings.length} request(s) failed` : '';
			    shell.titleSpan.textContent = `Post Tree: Root #${rootId} (${postsMap.size} posts in tree${incomplete})`;
			    if (warnings.length) U.logWarn('tree', warnings.join('; '));
			
			    const treeContainer = D.el('div', { class: 'e621x-tree' });
			    const svgCanvas = document.createElementNS(SVG_NS, 'svg');
			    svgCanvas.setAttribute('class', 'e621x-tree-lines');
			    treeContainer.appendChild(svgCanvas);
			
			    const cardMap = new Map();
			    const renderedCards = [];
			    const lineConnections = [];
			    const tiers = buildTiers(rootNode);
			
			    tiers.forEach((tierItems, index) => {
			      const gen = index + 1;
			      const cardsRow = D.el('div', { class: 'e621x-tree-cards' });
			
			      for (const { node, parentNode } of tierItems) {
			        const hasParent = Boolean(parentNode);
			        const hasChildren = node.children.length > 0;
			        const card = Thumb.createThumbnail(node.post, { layout: getLayout(), gen, hasParent, hasChildren, enablePins: true });
			        bindLineHighlight(card, node.post.id, svgCanvas);
			        cardsRow.appendChild(card);
			        cardMap.set(node.post.id, card);
			        renderedCards.push({ card, post: node.post, gen, hasParent, hasChildren });
			      }
			
			      treeContainer.appendChild(
			        D.el('div', { class: 'e621x-tree-tier', 'data-gen': gen }, [createDivider(gen, tierItems.length), cardsRow])
			      );
			    });
			
			    for (const tierItems of tiers) {
			      for (const { node, parentNode } of tierItems) {
			        if (!parentNode) continue;
			        const fromEl = cardMap.get(parentNode.post.id);
			        const toEl = cardMap.get(node.post.id);
			        if (fromEl && toEl) lineConnections.push({ fromEl, toEl, fromId: parentNode.post.id, toId: node.post.id });
			      }
			    }
			
			    treeContainer.appendChild(D.el('div', { class: 'e621x-tree-spacer' }));
			    shell.contentArea.replaceChildren(treeContainer);
			
			    const drawLines = createLineDrawer(treeContainer, svgCanvas, lineConnections);
			
			    shell.btnExportJson.onclick = () => TreeExport.exportTreeToJson(rootNode, postsMap, rootId);
			    shell.btnExportSvg.onclick = async () => {
			      shell.btnExportSvg.disabled = true;
			      try {
			        await TreeExport.exportTreeToSvg({
			          treeContainer, renderedCards, lineConnections, rootId, isContain: getLayout().isContain
			        });
			      } catch (err) {
			        U.showToast(`SVG export failed: ${err.message}`, true);
			      } finally {
			        shell.btnExportSvg.disabled = false;
			      }
			    };
			
			    // everything below is released by the disposer when the modal closes
			    const resizeObserver = new ResizeObserver(drawLines);
			    resizeObserver.observe(treeContainer);
			    disposer.add(() => resizeObserver.disconnect());
			
			    window.addEventListener('resize', drawLines);
			    disposer.add(() => window.removeEventListener('resize', drawLines));
			
			    const timer = setTimeout(drawLines, FIRST_DRAW_DELAY_MS);
			    disposer.add(() => clearTimeout(timer));
			
			    return drawLines;
			  }
			
			  // ---------- public: open modal ----------
			  async function openPostTreeModal(targetPostId) {
			    closeActiveModal?.();
			
			    const disposer = U.createDisposer();
			    const shell = createModalShell(targetPostId);
			    let layout = Layout.getLayoutSettings();
			    Layout.applyLayoutVars(shell.dialog, layout);
			    document.body.append(shell.overlay, shell.dialog);
			
			    const close = () => disposer.run();
			    closeActiveModal = close;
			    disposer.add(() => { if (closeActiveModal === close) closeActiveModal = null; });
			    disposer.add(() => { shell.overlay.remove(); shell.dialog.remove(); });
			
			    shell.closeBtn.addEventListener('click', close);
			    shell.overlay.addEventListener('click', close);
			
			    const onKeydown = (e) => { if (e.key === 'Escape') close(); };
			    document.addEventListener('keydown', onKeydown);
			    disposer.add(() => document.removeEventListener('keydown', onKeydown));
			
			    try {
			      const tree = await TreeData.fetchFullTree(targetPostId);
			      if (disposer.isDisposed()) return; // closed while loading
			      const drawLines = renderTree(shell, tree, disposer, () => layout);
			
			      disposer.add(Layout.onLayoutSettingsChange((next) => {
			        layout = next;
			        Layout.applyLayoutVars(shell.dialog, next);
			        drawLines();
			      }));
			    } catch (err) {
			      if (disposer.isDisposed()) return;
			      U.logWarn('tree', err);
			      shell.contentArea.replaceChildren(
			        D.el('div', { class: 'e621x-tree-message e621x-tree-message--error', text: `Error loading tree: ${err.message}` })
			      );
			    }
			  }
			
			  // ---------- "show post tree" button next to parent/child notices ----------
			  function setupPageNoticeTreeButton() {
			    document.querySelector(SEL.parentChildren)?.classList.add('e621x-notice-row');
			
			    const notices = document.querySelectorAll(SEL.relationNotices);
			    if (!notices.length) return;
			    notices.forEach(n => n.classList.add('e621x-notice-inline'));
			
			    if (document.getElementById('btn-show-post-tree')) return;
			    const currentPostId = U.getPostIdFromPage();
			    if (!currentPostId) return;
			
			    const treeBtn = D.button({
			      text: 'show post tree',
			      className: 'e621x-tree-btn',
			      onClick: (e) => { e.preventDefault(); openPostTreeModal(currentPostId); }
			    });
			    treeBtn.id = 'btn-show-post-tree';
			    notices[notices.length - 1].appendChild(treeBtn);
			  }
			
			  return { init: setupPageNoticeTreeButton, open: openPostTreeModal };
			});
			// END: scripts/tree/modal.js
			
			// START: scripts/hover_zoom/data.js
			/* Data extraction and formatting helpers for Hover Zoom. */
			E621X.define('hoverZoomData', [], () => {
			  'use strict';
			
			  const PLACEHOLDER_IMG = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
			
			  const clamp = (val, min, max) => Math.min(Math.max(val, min), max);
			
			  function parsePostFromElement(el) {
			    if (!el) return null;
			
			    // Skip main post image/video on individual post pages
			    if (el.classList?.contains('fit-window') || el.closest('.fit-window, #image-container')) {
			      return null;
			    }
			
			    const thumb = el.closest('article.thumbnail, .post-preview, div.post-thumbnail, [data-id]');
			    if (!thumb || thumb.id === 'image-container' || thumb.closest('#image-container, .fit-window')) {
			      return null;
			    }
			
			    const d = thumb.dataset || {};
			    const id = Number(d.id || thumb.getAttribute('data-id'));
			    if (!id) return null;
			
			    const fileUrl = d.fileUrl || '';
			    const sampleUrl = d.sampleUrl || d.largeFileUrl || fileUrl;
			    const previewUrl = d.previewUrl || d.previewFileUrl || thumb.querySelector('img')?.src || '';
			
			    // Extract file extension from dataset or URL
			    let ext = (d.fileExt || '').toLowerCase();
			    if (!ext && sampleUrl) {
			      const match = sampleUrl.match(/\.([a-z0-9]+)(?:\?|$)/i);
			      if (match) ext = match[1].toLowerCase();
			    }
			
			    return {
			      id,
			      ext,
			      isVideo: ext === 'webm' || ext === 'mp4',
			      isDeleted: d.flags?.includes('deleted') || thumb.classList.contains('post-status-deleted'),
			      sampleUrl,
			      previewUrl,
			      fileUrl,
			      element: thumb
			    };
			  }
			
			  return {
			    PLACEHOLDER_IMG,
			    clamp,
			    parsePostFromElement
			  };
			});
			// END: scripts/hover_zoom/data.js
			
			// START: scripts/hover_zoom/index.js
			E621X.define('hoverZoom', ['utils', 'selectors', 'dom', 'hoverZoomData'], (U, SEL, D, HZData) => {
			  'use strict';
			  const { STORAGE_KEYS: KEYS } = E621_CONSTANTS;
			  const { clamp, parsePostFromElement, PLACEHOLDER_IMG } = HZData;
			
			  const VIEWPORT_MARGIN = 12;
			  const CURSOR_OFFSET_X = 24;
			
			  let enabled = true;
			  let loadSample = true; // default true: load /data/sample/*
			  let targetFps = 0; // 0 = native monitor refresh rate via requestAnimationFrame
			  let dom = null;
			  let activePost = null;
			  let shiftPressed = false;
			  let lastClientX = 0;
			  let lastClientY = 0;
			  let scheduled = false;
			  let lastTime = 0;
			  let stashedTitles = [];
			
			  // ---------- Exact Dimension Calculation ----------
			  function updateMediaDimensions(mediaEl) {
			    if (!activePost || !dom) return;
			
			    const naturalW = mediaEl.naturalWidth || mediaEl.videoWidth || 0;
			    const naturalH = mediaEl.naturalHeight || mediaEl.videoHeight || 0;
			    if (!naturalW || !naturalH) return;
			
			    const maxW = Math.floor(window.innerWidth * 0.55);
			    const maxH = Math.floor(window.innerHeight * 0.88);
			
			    let w = naturalW;
			    let h = naturalH;
			
			    // Scale down to fit inside max bounds while preserving exact aspect ratio
			    if (w > maxW) {
			      h = Math.round(h * (maxW / w));
			      w = maxW;
			    }
			    if (h > maxH) {
			      w = Math.round(w * (maxH / h));
			      h = maxH;
			    }
			
			    mediaEl.style.width = `${w}px`;
			    mediaEl.style.height = `${h}px`;
			    dom.container.style.width = `${w}px`;
			    dom.container.style.height = `${h}px`;
			
			    dom.container.classList.remove('is-hidden');
			    alignWindow(lastClientX, lastClientY);
			
			    window.dispatchEvent(new CustomEvent('e621x-zoom-change', { detail: { active: true } }));
			  }
			
			  // ---------- DOM Setup ----------
			  function createZoomContainer() {
			    if (document.getElementById('e621x-zoom-container')) return;
			
			    const container = D.el('div', {
			      id: 'e621x-zoom-container',
			      class: 'e621x-zoom is-hidden'
			    });
			
			    const img = D.el('img', {
			      id: 'e621x-zoom-img',
			      class: 'e621x-zoom-media is-hidden',
			      src: PLACEHOLDER_IMG,
			      alt: ''
			    });
			
			    const video = D.el('video', {
			      id: 'e621x-zoom-video',
			      class: 'e621x-zoom-media is-hidden',
			      loop: true,
			      playsinline: true,
			      controls: false,
			      autoplay: true,
			      muted: true
			    });
			
			    img.addEventListener('load', () => {
			      if (img.src !== PLACEHOLDER_IMG) updateMediaDimensions(img);
			    });
			
			    // Fallback: if sample 404s, seamlessly load full fileUrl
			    img.addEventListener('error', () => {
			      if (img.src && !img.src.startsWith('data:') && activePost?.fileUrl && img.src !== activePost.fileUrl) {
			        img.src = activePost.fileUrl;
			      }
			    });
			
			    video.addEventListener('loadedmetadata', () => {
			      updateMediaDimensions(video);
			    });
			
			    video.addEventListener('error', () => {
			      if (video.src && activePost?.fileUrl && video.src !== activePost.fileUrl) {
			        video.src = activePost.fileUrl;
			        video.play().catch(() => {});
			      }
			    });
			
			    container.append(img, video);
			    document.body.appendChild(container);
			
			    dom = { container, img, video };
			  }
			
			  // ---------- Tooltip Suppressor ----------
			  function suppressTooltips(element) {
			    restoreTooltips();
			    if (!element) return;
			
			    const targets = element.hasAttribute('title') ? [element] : [];
			    targets.push(...element.querySelectorAll('[title]'));
			
			    for (const el of targets) {
			      const title = el.getAttribute('title');
			      if (title) {
			        stashedTitles.push({ el, title });
			        el.removeAttribute('title');
			      }
			    }
			  }
			
			  function restoreTooltips() {
			    while (stashedTitles.length) {
			      const { el, title } = stashedTitles.pop();
			      try { el.setAttribute('title', title); } catch (_) {
			        // Ignored
			      }
			    }
			  }
			
			  // ---------- Positioning ----------
			  function alignWindow(clientX, clientY) {
			    if (!dom || dom.container.classList.contains('is-hidden')) return;
			
			    const vw = window.innerWidth;
			    const vh = window.innerHeight;
			    const rect = dom.container.getBoundingClientRect();
			    const boxW = rect.width;
			    const boxH = rect.height;
			    if (!boxW || !boxH) return;
			
			    let left;
			    if (clientX < vw / 2) {
			      left = clientX + CURSOR_OFFSET_X;
			      if (left + boxW > vw - VIEWPORT_MARGIN) left = vw - boxW - VIEWPORT_MARGIN;
			    } else {
			      left = clientX - boxW - CURSOR_OFFSET_X;
			      if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
			    }
			
			    const top = clamp(clientY - (boxH / 2), VIEWPORT_MARGIN, vh - boxH - VIEWPORT_MARGIN);
			
			    dom.container.style.left = `${Math.round(left)}px`;
			    dom.container.style.top = `${Math.round(top)}px`;
			  }
			
			  function requestAlignWindow() {
			    if (scheduled) return;
			    scheduled = true;
			
			    const now = performance.now();
			    const minInterval = targetFps > 0 ? (1000 / targetFps) : 0;
			    const wait = Math.max(0, minInterval - (now - lastTime));
			
			    const execute = () => {
			      requestAnimationFrame(() => {
			        scheduled = false;
			        lastTime = performance.now();
			        alignWindow(lastClientX, lastClientY);
			      });
			    };
			
			    if (wait > 0) {
			      setTimeout(execute, wait);
			    } else {
			      execute();
			    }
			  }
			
			  // ---------- Zoom Lifecycle ----------
			  function stopZoom() {
			    activePost = null;
			    restoreTooltips();
			
			    if (!dom) return;
			    const wasVisible = !dom.container.classList.contains('is-hidden');
			    dom.container.classList.add('is-hidden');
			    dom.container.style.width = '';
			    dom.container.style.height = '';
			
			    dom.img.classList.add('is-hidden');
			    dom.img.style.width = '';
			    dom.img.style.height = '';
			    dom.img.src = PLACEHOLDER_IMG;
			
			    dom.video.classList.add('is-hidden');
			    dom.video.style.width = '';
			    dom.video.style.height = '';
			    dom.video.pause();
			    dom.video.removeAttribute('src');
			    dom.video.load();
			
			    if (wasVisible) {
			      window.dispatchEvent(new CustomEvent('e621x-zoom-change', { detail: { active: false } }));
			    }
			  }
			
			  function startZoom(post) {
			    if (!enabled || !shiftPressed || !post || post.ext === 'swf' || post.isDeleted) return;
			
			    activePost = post;
			    suppressTooltips(post.element);
			
			    const targetMediaUrl = loadSample
			      ? (post.sampleUrl || post.fileUrl)
			      : (post.fileUrl || post.sampleUrl);
			
			    if (post.isVideo) {
			      dom.img.classList.add('is-hidden');
			      dom.video.classList.remove('is-hidden');
			      dom.video.src = targetMediaUrl;
			      dom.video.play().catch(() => {});
			    } else {
			      dom.video.classList.add('is-hidden');
			      dom.img.classList.remove('is-hidden');
			
			      const targetUrl = targetMediaUrl || post.previewUrl;
			      dom.img.src = targetUrl;
			
			      if (dom.img.complete && dom.img.naturalWidth > 0) {
			        updateMediaDimensions(dom.img);
			      }
			    }
			  }
			
			  // ---------- Event Listeners ----------
			  function setupEvents() {
			    document.addEventListener('mousemove', (e) => {
			      lastClientX = e.clientX;
			      lastClientY = e.clientY;
			
			      requestAlignWindow();
			    }, { passive: true });
			
			    document.addEventListener('mouseover', (e) => {
			      if (!enabled || !shiftPressed) return;
			      const thumb = e.target.closest(SEL.thumbnail) || e.target.closest('.post-preview, div.post-thumbnail');
			      if (!thumb) return;
			
			      const post = parsePostFromElement(thumb);
			      if (post && activePost?.id !== post.id) {
			        startZoom(post);
			      }
			    });
			
			    document.addEventListener('mouseout', (e) => {
			      if (!activePost) return;
			      const thumb = e.target.closest(SEL.thumbnail) || e.target.closest('.post-preview, div.post-thumbnail');
			      if (!thumb) return;
			
			      const related = e.relatedTarget ? e.relatedTarget.closest(SEL.thumbnail) || e.relatedTarget.closest('.post-preview') : null;
			      if (related === thumb) return;
			
			      stopZoom();
			    });
			
			    window.addEventListener('keydown', (e) => {
			      if (e.key !== 'Shift' || shiftPressed) return;
			      shiftPressed = true;
			
			      if (enabled && !activePost) {
			        const hovered = document.elementFromPoint(lastClientX, lastClientY);
			        const post = parsePostFromElement(hovered);
			        if (post) startZoom(post);
			      }
			    });
			
			    window.addEventListener('keyup', (e) => {
			      if (e.key !== 'Shift') return;
			      shiftPressed = false;
			      stopZoom();
			    });
			
			    window.addEventListener('blur', () => {
			      shiftPressed = false;
			      stopZoom();
			    });
			
			    window.addEventListener('scroll', () => {
			      if (activePost) stopZoom();
			    }, { passive: true });
			  }
			
			  async function init() {
			    createZoomContainer();
			    const data = await chrome.storage.local.get([KEYS.HZ_ENABLED, KEYS.HZ_LOAD_SAMPLE, KEYS.TRACKING_FPS]);
			    enabled = data[KEYS.HZ_ENABLED] !== false;
			    loadSample = data[KEYS.HZ_LOAD_SAMPLE] !== false;
			    targetFps = Number(data[KEYS.TRACKING_FPS]) || 0;
			    setupEvents();
			
			    chrome.storage.onChanged.addListener((changes, area) => {
			      if (area === 'local') {
			        if (changes[KEYS.HZ_ENABLED]) {
			          enabled = changes[KEYS.HZ_ENABLED].newValue !== false;
			          if (!enabled) stopZoom();
			        }
			        if (changes[KEYS.HZ_LOAD_SAMPLE]) {
			          loadSample = changes[KEYS.HZ_LOAD_SAMPLE].newValue !== false;
			        }
			        if (changes[KEYS.TRACKING_FPS] !== undefined) {
			          targetFps = Number(changes[KEYS.TRACKING_FPS].newValue) || 0;
			        }
			      }
			    });
			  }
			
			  return { init };
			});
			// END: scripts/hover_zoom/index.js
			
			// START: scripts/tag_script/engine.js
			/* Tag script engine: pure functions, no DOM. Loaded as a content script and by Node tests. */
			(function (root, factory) {
			  const api = factory();
			  if (typeof module !== 'undefined' && module.exports) module.exports = api;
			  else root.E621X.define('tagScriptEngine', [], () => api);
			})(globalThis, function () {
			  'use strict';
			
			  // ---------- parsing ----------
			  function parseIfCommand(cmdStr) {
			    if (!cmdStr.startsWith('[') || !cmdStr.endsWith(']')) return null;
			    const inner = cmdStr.slice(1, -1).trim();
			    if (!inner.startsWith('if')) return null;
			
			    const afterIf = inner.slice(2).trim();
			    const commaIdx = afterIf.indexOf(',');
			    if (commaIdx === -1) return null;
			
			    return {
			      predicate: afterIf.slice(0, commaIdx).trim(),
			      action: afterIf.slice(commaIdx + 1).trim()
			    };
			  }
			
			  // ---------- predicates ----------
			  function evaluateSimplePredicate(predicate, post) {
			    return (predicate.match(/\S+/g) || []).every(x =>
			      x.startsWith('-') ? !post.tagsSet.has(x.slice(1)) : post.tagsSet.has(x));
			  }
			
			  // ---------- execution ----------
			  /* Returns the tag diff string ('' if nothing changes). */
			  function runTagScript(post, scriptContent) {
			    const tokens = scriptContent.match(/\[.+?\]|\S+/g) || [];
			    let isReset = false;
			    const diffs = [];
			
			    for (const cmd of tokens) {
			      if (cmd === '[reset]') {
			        isReset = true;
			        diffs.length = 0;
			        continue;
			      }
			
			      if (cmd.startsWith('[if')) {
			        const parsed = parseIfCommand(cmd);
			        if (parsed && evaluateSimplePredicate(parsed.predicate, post)) {
			          diffs.push(parsed.action);
			        }
			        continue;
			      }
			
			      diffs.push(cmd);
			    }
			
			    if (isReset) {
			      return [...Array.from(post.tagsSet, t => `-${t}`), ...diffs].join(' ');
			    }
			    return diffs.join(' ');
			  }
			
			  /* Normalises an API post (/posts/:id.json) into the shape the predicates expect. */
			  function postDataFromApi(post) {
			    const tagString = typeof post.tag_string === 'string'
			      ? post.tag_string
			      : Object.values(post.tags || {}).flat().join(' ');
			
			    return {
			      id: Number(post.id),
			      tagsSet: new Set(tagString.split(/\s+/).filter(Boolean))
			    };
			  }
			
			  return { runTagScript, postDataFromApi };
			});
			// END: scripts/tag_script/engine.js
			
			// START: scripts/tag_script/queue.js
			/* Tag script queue client: delegates mutations and processing to background.js
			 * and uses IndexedDB for image storage to avoid storage quota issues. */
			E621X.define('tagScriptQueue', ['utils', 'net'], (U, Net) => {
			  'use strict';
			  const { STORAGE_KEYS: KEYS, ACTIONS } = E621_CONSTANTS;
			  const HOURLY_EDIT_LIMIT = 150;
			  const ONE_HOUR_MS = 60 * 60 * 1000;
			
			  async function isEnabled() {
			    return Boolean(await U.storageGet(KEYS.QUEUE_TAG_SCRIPTS_ENABLED, false));
			  }
			
			  async function setEnabled(val) {
			    await U.storageSet(KEYS.QUEUE_TAG_SCRIPTS_ENABLED, Boolean(val));
			  }
			
			  async function getTimeoutUntil() {
			    return Number(await U.storageGet(KEYS.QUEUE_TIMEOUT_UNTIL, 0)) || 0;
			  }
			
			  async function isTimeoutActive() {
			    if (!(await isEnabled())) return false;
			    const until = await getTimeoutUntil();
			    return Date.now() < until;
			  }
			
			  async function getRemainingTimeoutMs() {
			    const until = await getTimeoutUntil();
			    return Math.max(0, until - Date.now());
			  }
			
			  async function getQueue() {
			    return (await U.storageGet(KEYS.TAG_SCRIPT_QUEUE, {})) || {};
			  }
			
			  async function getQueueCount() {
			    const q = await getQueue();
			    return Object.keys(q).length;
			  }
			
			  async function getSlotSchedule() {
			    return (await U.storageGet(KEYS.QUEUE_SLOT_TIMESTAMPS, [])) || [];
			  }
			
			  // ---------- IndexedDB image operations via background ----------
			  async function saveImage(postId, dataUrl) {
			    if (!dataUrl) return;
			    try {
			      await chrome.runtime.sendMessage({ action: ACTIONS.SAVE_IMAGE, postId, dataUrl });
			    } catch (err) {
			      U.logWarn('saveImage to IndexedDB', err);
			    }
			  }
			
			  async function getImage(postId) {
			    try {
			      const res = await chrome.runtime.sendMessage({ action: ACTIONS.GET_IMAGE, postId });
			      return res?.dataUrl || null;
			    } catch (err) {
			      U.logWarn('getImage from IndexedDB', err);
			      return null;
			    }
			  }
			
			  async function deleteImage(postId) {
			    try {
			      await chrome.runtime.sendMessage({ action: ACTIONS.DELETE_IMAGE, postId });
			    } catch (err) {
			      U.logWarn('deleteImage from IndexedDB', err);
			    }
			  }
			
			  async function clearImages() {
			    try {
			      await chrome.runtime.sendMessage({ action: ACTIONS.CLEAR_IMAGES });
			    } catch (err) {
			      U.logWarn('clearImages from IndexedDB', err);
			    }
			  }
			
			  /* Fetches image as Base64 via service worker (avoids CORS) */
			  async function fetchImageAsBase64(url) {
			    if (!url || typeof url !== 'string' || url.startsWith('data:')) return url || null;
			    try {
			      const res = await chrome.runtime.sendMessage({ action: ACTIONS.FETCH_IMAGE, url });
			      if (res?.ok && res.dataUrl) return res.dataUrl;
			    } catch (_) {}
			    return null;
			  }
			
			  /* Fast extraction of Base64 from loaded DOM img tag, falls back to fetch */
			  async function getBase64FromThumb(thumb, previewUrl) {
			    const img = thumb?.querySelector?.('img');
			    if (img && img.complete && img.naturalWidth > 0) {
			      try {
			        const canvas = document.createElement('canvas');
			        canvas.width = img.naturalWidth;
			        canvas.height = img.naturalHeight;
			        const ctx = canvas.getContext('2d');
			        ctx.drawImage(img, 0, 0);
			        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
			        if (dataUrl && dataUrl.startsWith('data:image/')) return dataUrl;
			      } catch (_) {
			        // Canvas tainted by CORS, fallback to background service worker
			      }
			    }
			
			    const targetUrl = previewUrl || thumb?.dataset?.previewUrl || img?.src;
			    if (targetUrl) {
			      const b64 = await fetchImageAsBase64(targetUrl);
			      if (b64) return b64;
			    }
			    return null;
			  }
			
			  function extractThumbData(thumb) {
			    if (!thumb) return {};
			    const d = thumb.dataset || {};
			    const img = thumb.querySelector('img');
			    const previewUrl = d.previewUrl || img?.src || '';
			
			    return {
			      previewUrl,
			      score: Number(d.score || 0),
			      favCount: Number(d.favCount || 0),
			      commentCount: Number(d.commentCount || 0),
			      rating: String(d.rating || 's').toLowerCase(),
			      fileExt: String(d.fileExt || 'jpg').toLowerCase(),
			      tags: d.tags || '',
			      flags: d.flags || '',
			      hasParent: thumb.querySelector('.ribbon.left') !== null || d.hasParent === 'true',
			      hasChildren: thumb.querySelector('.ribbon.right') !== null || d.hasChildren === 'true'
			    };
			  }
			
			  async function enqueue(postId, editData) {
			    const id = Number(postId);
			    const thumbnailDataUrl = editData.thumbnailDataUrl;
			    if (thumbnailDataUrl) {
			      await saveImage(id, thumbnailDataUrl);
			    }
			
			    const sanitized = { ...editData };
			    delete sanitized.thumbnailDataUrl;
			
			    const res = await chrome.runtime.sendMessage({
			      action: ACTIONS.ENQUEUE_TAG_SCRIPT,
			      postId: id,
			      editData: sanitized
			    });
			
			    return res?.queue || (await getQueue());
			  }
			
			  async function enqueueFromThumb(thumb, editData) {
			    const postId = Number(thumb.dataset.id);
			    const meta = extractThumbData(thumb);
			    const b64 = await getBase64FromThumb(thumb, meta.previewUrl);
			
			    return enqueue(postId, {
			      ...meta,
			      ...editData,
			      thumbnailDataUrl: b64 || meta.previewUrl
			    });
			  }
			
			  async function dequeue(postId) {
			    const id = Number(postId);
			    await deleteImage(id);
			    const res = await chrome.runtime.sendMessage({
			      action: ACTIONS.DEQUEUE_TAG_SCRIPT,
			      postId: id
			    });
			    return res?.queue || (await getQueue());
			  }
			
			  async function clearQueue() {
			    await clearImages();
			    await chrome.runtime.sendMessage({ action: ACTIONS.CLEAR_TAG_QUEUE });
			  }
			
			  async function processQueue() {
			    try {
			      const res = await chrome.runtime.sendMessage({ action: ACTIONS.PROCESS_TAG_QUEUE });
			      if (res?.ok) {
			        return res;
			      }
			      return { total: 0, updated: 0, errors: 1, error: res?.error };
			    } catch (err) {
			      U.logWarn('processQueue request failed', err);
			      return { total: 0, updated: 0, errors: 1, error: err.message };
			    }
			  }
			
			  async function checkPostLockStatus(postId, changes = '') {
			    const thumb = document.querySelector(`article.thumbnail[data-id="${postId}"]`);
			    if (thumb) {
			      const flags = (thumb.dataset.flags || '').split(/\s+/);
			      if (flags.includes('deleted') || thumb.classList.contains('post-status-deleted')) {
			        return { isLocked: true, reason: 'Post is deleted' };
			      }
			      if (flags.includes('status_locked') || flags.includes('statuslocked')) {
			        return { isLocked: true, reason: 'Post is status locked' };
			      }
			      if (flags.includes('rating_locked') && /(?:^|\s)[-+]?rating:[sqe]/i.test(changes)) {
			        return { isLocked: true, reason: `Rating is locked on post #${postId}` };
			      }
			    }
			
			    try {
			      const data = await Net.fetchJson(`/posts/${postId}.json`);
			      const post = data?.post || data;
			      if (!post) return { isLocked: false, reason: '' };
			
			      const flags = post.flags || {};
			      if (flags.status_locked || post.is_status_locked) {
			        return { isLocked: true, reason: 'Post is status locked' };
			      }
			      if (flags.deleted || post.is_deleted) {
			        return { isLocked: true, reason: 'Post is deleted' };
			      }
			
			      let lockedTags = [];
			      if (Array.isArray(post.locked_tags)) {
			        lockedTags = post.locked_tags;
			      } else if (typeof post.locked_tags === 'string') {
			        lockedTags = post.locked_tags.split(/\s+/).filter(Boolean);
			      }
			
			      if (lockedTags.length > 0 && changes) {
			        const lockedSet = new Set(lockedTags.map(t => String(t).trim().toLowerCase()));
			        const tokens = String(changes).split(/\s+/).filter(Boolean);
			        for (const token of tokens) {
			          if (token.includes(':') && !token.startsWith('-') && !token.startsWith('+')) continue;
			          const cleanTag = token.replace(/^[-+]/, '').toLowerCase();
			          if (lockedSet.has(cleanTag)) {
			            return { isLocked: true, reason: `Tag "${cleanTag}" is locked on post #${postId}` };
			          }
			        }
			      }
			
			      if ((flags.rating_locked || post.is_rating_locked) && /(?:^|\s)[-+]?rating:[sqe]/i.test(changes)) {
			        return { isLocked: true, reason: `Rating is locked on post #${postId}` };
			      }
			
			      return { isLocked: false, reason: '' };
			    } catch (err) {
			      U.logWarn(`checkPostLockStatus #${postId}`, err);
			      return { isLocked: false, reason: '' };
			    }
			  }
			
			  function isHourlyLimitResponse(status, errorText) {
			    if (status === 429) return true;
			    if (status === 403) {
			      const msg = String(errorText || '').toLowerCase();
			      return msg.includes('hourly limit') || msg.includes('limit exceeded') || msg.includes('throttl');
			    }
			    return false;
			  }
			
			  async function parseErrorBody(res) {
			    try {
			      const data = await res.json();
			      if (data.reason) return data.reason;
			      if (data.errors) {
			        if (typeof data.errors === 'object') return Object.values(data.errors).flat().join('; ');
			        if (Array.isArray(data.errors)) return data.errors.join('; ');
			      }
			      if (data.message) return data.message;
			    } catch (_) {}
			    return `HTTP ${res.status}`;
			  }
			
			  function formatDuration(ms) {
			    const totalSec = Math.ceil(ms / 1000);
			    const hours = Math.floor(totalSec / 3600);
			    const mins = Math.floor((totalSec % 3600) / 60);
			    const secs = totalSec % 60;
			    if (hours > 0) return `${hours}h ${mins}m`;
			    if (mins > 0) return `${mins}m ${secs}s`;
			    return `${secs}s`;
			  }
			
			  async function getQueueTimingInfo() {
			    const queue = await getQueue();
			    const count = Object.keys(queue).length;
			    if (count === 0) {
			      return { count: 0, nextMs: 0, allMs: 0, isTimeout: false, nextSlot: 0, allSlot: 0 };
			    }
			
			    let slots = await getSlotSchedule();
			    const now = Date.now();
			
			    if (!slots.length) {
			      const until = await getTimeoutUntil();
			      const nextMs = Math.max(0, until - now);
			      return { count, nextMs, allMs: nextMs, isTimeout: nextMs > 0, nextSlot: until, allSlot: until };
			    }
			
			    while (slots.length < count) {
			      const baseIdx = Math.max(0, slots.length - HOURLY_EDIT_LIMIT);
			      slots.push((slots[baseIdx] || now) + ONE_HOUR_MS);
			    }
			
			    const nextSlot = slots[0] || now;
			    const nextMs = Math.max(0, nextSlot - now);
			    const allSlotIdx = Math.min(count - 1, slots.length - 1);
			    const allSlot = slots[allSlotIdx] || nextSlot;
			    const allMs = Math.max(0, allSlot - now);
			
			    return { count, nextMs, allMs, isTimeout: nextMs > 0, nextSlot, allSlot };
			  }
			
			  async function init() {}
			
			  return {
			    init,
			    isEnabled,
			    setEnabled,
			    getTimeoutUntil,
			    isTimeoutActive,
			    getRemainingTimeoutMs,
			    getQueueTimingInfo,
			    getSlotSchedule,
			    checkPostLockStatus,
			    isHourlyLimitResponse,
			    getQueue,
			    getQueueCount,
			    enqueue,
			    enqueueFromThumb,
			    extractThumbData,
			    fetchImageAsBase64,
			    dequeue,
			    clearQueue,
			    formatDuration,
			    processQueue,
			    parseErrorBody,
			    saveImage,
			    getImage,
			    deleteImage,
			    clearImages,
			    HOURLY_EDIT_LIMIT
			  };
			});
			// END: scripts/tag_script/queue.js
			
			// START: scripts/tag_script/timeouted_page.js
			E621X.define('timeoutedPage',
			  ['utils', 'dom', 'layout', 'thumbnail', 'tagScriptQueue', 'treeData'],
			  (U, D, Layout, Thumb, Queue, TreeData) => {
			  'use strict';
			
			  const isTimeoutedPage = () => /^\/posts\/timeouted\/?$/i.test(location.pathname);
			  let countdownTimer = null;
			
			  function createHeader(queueCount, timing, onProcess, onClear) {
			    const isTimeout = timing.isTimeout;
			    const statusText = isTimeout
			      ? (queueCount > 1
			          ? `Next in ${Queue.formatDuration(timing.nextMs)} · All finish in ${Queue.formatDuration(timing.allMs)}`
			          : `Next in ${Queue.formatDuration(timing.nextMs)}`)
			      : 'Status: Ready to submit';
			
			    const statusPill = D.el('div', {
			      id: 'e621x-queue-status-pill',
			      class: `e621x-queue-status-pill ${isTimeout ? 'is-timeout' : 'is-ready'}`,
			      text: statusText
			    });
			
			    const btnProcess = D.button({
			      id: 'e621x-btn-process-queue',
			      text: 'Process Queue Now',
			      primary: true,
			      onClick: onProcess
			    });
			    btnProcess.disabled = queueCount === 0;
			
			    const btnClear = D.button({
			      text: 'Clear Queue',
			      onClick: onClear
			    });
			    btnClear.disabled = queueCount === 0;
			
			    return D.el('header', { class: 'e621x-queue-header' }, [
			      D.el('div', { class: 'e621x-queue-title-area' }, [
			        D.el('h2', {}, [
			          'Queued Tag Scripts',
			          D.el('span', { class: 'e621x-queue-badge', text: `${queueCount} posts` })
			        ]),
			        D.el('span', { class: 'e621x-queue-subtitle', text: 'Delayed post edits waiting to be sent to e621' })
			      ]),
			      D.el('div', { class: 'e621x-queue-actions' }, [
			        statusPill,
			        btnProcess,
			        btnClear
			      ])
			    ]);
			  }
			
			  function startLiveCountdown(untilNext, untilAll, count, onTimeoutElapsed) {
			    if (countdownTimer) clearInterval(countdownTimer);
			    if (!untilNext || untilNext <= Date.now()) return;
			
			    countdownTimer = setInterval(() => {
			      const now = Date.now();
			      const nextRemaining = untilNext - now;
			      const allRemaining = untilAll - now;
			      const pill = document.getElementById('e621x-queue-status-pill');
			
			      if (nextRemaining <= 0) {
			        clearInterval(countdownTimer);
			        countdownTimer = null;
			        if (pill) {
			          pill.className = 'e621x-queue-status-pill is-ready';
			          pill.textContent = 'Status: Ready to submit';
			        }
			        if (typeof onTimeoutElapsed === 'function') onTimeoutElapsed();
			      } else if (pill) {
			        pill.textContent = count > 1
			          ? `Next in ${Queue.formatDuration(nextRemaining)} · All finish in ${Queue.formatDuration(allRemaining)}`
			          : `Next in ${Queue.formatDuration(nextRemaining)}`;
			      }
			    }, 1000);
			  }
			
			  function createQueueCard(post, queueItem, onRemove) {
			    const layout = Layout.getLayoutSettings();
			    const card = Thumb.createThumbnail(post, { layout, enablePins: false });
			    card.classList.add('e621x-thumb-queued');
			
			    const meta = D.el('div', { class: 'e621x-queue-card-meta' }, [
			      D.el('div', { class: 'e621x-queue-diff', title: queueItem.changes, text: queueItem.changes }),
			      D.el('div', { class: 'e621x-queue-card-actions' }, [
			        D.el('span', { text: queueItem.reason ? `Reason: ${queueItem.reason}` : '' }),
			        D.el('button', {
			          type: 'button',
			          class: 'e621x-queue-remove-btn',
			          text: 'Remove',
			          onClick: (e) => {
			            e.preventDefault();
			            e.stopPropagation();
			            onRemove(post.id);
			          }
			        })
			      ])
			    ]);
			
			    return D.el('div', { class: 'e621x-queue-card-wrap', 'data-post-id': post.id }, [
			      card,
			      meta
			    ]);
			  }
			
			  async function renderPage() {
			    document.title = 'Queued Tag Scripts - e621';
			
			    let mainContainer = document.querySelector('#c-posts #content, #content, #page, main');
			    if (!mainContainer) {
			      mainContainer = document.createElement('div');
			      document.body.appendChild(mainContainer);
			    }
			
			    const pageRoot = D.el('div', { class: 'e621x-queue-page' }, [
			      D.el('div', { class: 'e621x-tree-message', text: 'Loading queued posts...' })
			    ]);
			
			    mainContainer.replaceChildren(pageRoot);
			
			    const layout = Layout.getLayoutSettings();
			    Layout.applyLayoutVars(pageRoot, layout);
			
			    async function refresh() {
			      if (countdownTimer) {
			        clearInterval(countdownTimer);
			        countdownTimer = null;
			      }
			
			      const queue = await Queue.getQueue();
			      const ids = Object.keys(queue).map(Number).filter(n => Number.isInteger(n) && n > 0);
			      const timing = await Queue.getQueueTimingInfo();
			
			      const handleProcess = async () => {
			        await Queue.processQueue();
			        await refresh();
			      };
			
			      const handleClear = async () => {
			        if (!confirm('Clear all queued tag scripts?')) return;
			        await Queue.clearQueue();
			        U.showToast('Queue cleared');
			        await refresh();
			      };
			
			      const handleRemove = async (postId) => {
			        await Queue.dequeue(postId);
			        U.showToast(`Post #${postId} removed from queue`);
			        await refresh();
			      };
			
			      const header = createHeader(ids.length, timing, handleProcess, handleClear);
			
			      if (!ids.length) {
			        pageRoot.replaceChildren(
			          header,
			          D.el('div', { class: 'e621x-queue-empty' }, [
			            D.el('h3', { text: 'No tag scripts in queue' }),
			            D.el('p', { text: 'When hourly edit limits are active, clicked posts will queue here with a yellow outline.' })
			          ])
			        );
			        return;
			      }
			
			      // Check which posts lack metadata
			      const missingIds = ids.filter(id => {
			        const it = queue[id];
			        return !it || it.score === undefined;
			      });
			
			      const fetchedMap = new Map();
			      if (missingIds.length > 0) {
			        pageRoot.replaceChildren(header, D.el('div', { class: 'e621x-tree-message', text: `Caching data for ${missingIds.length} post(s)...` }));
			        try {
			          const posts = await TreeData.fetchByIds(missingIds);
			          for (const p of posts) {
			            fetchedMap.set(p.id, p);
			            const previewUrl = p.preview?.url || '';
			            if (previewUrl) {
			              const b64 = await Queue.fetchImageAsBase64(previewUrl);
			              if (b64) await Queue.saveImage(p.id, b64);
			            }
			          }
			        } catch (err) {
			          U.logWarn('timeouted page fetch missing', err);
			        }
			      }
			
			      const grid = D.el('div', { class: 'e621x-tree-cards' });
			
			      for (const id of ids) {
			        const item = queue[id] || {};
			        const fetched = fetchedMap.get(id);
			        const storedImage = await Queue.getImage(id);
			
			        const post = fetched || {
			          id,
			          rating: item.rating || 's',
			          score: item.score ?? 0,
			          fav_count: item.favCount ?? 0,
			          comment_count: item.commentCount ?? 0,
			          file: { ext: item.fileExt || 'jpg' },
			          tags: item.tags || '',
			          flags: item.flags || '',
			          has_parent: item.hasParent ?? false,
			          has_children: item.hasChildren ?? false,
			          preview: { url: storedImage || item.previewUrl || '' }
			        };
			
			        grid.appendChild(createQueueCard(post, item, handleRemove));
			      }
			
			      pageRoot.replaceChildren(header, grid);
			
			      if (timing.isTimeout) {
			        startLiveCountdown(timing.nextSlot, timing.allSlot, ids.length, () => {
			          U.showToast('Slot available! Queue ready.');
			        });
			      }
			    }
			
			    await refresh();
			
			    chrome.storage.onChanged.addListener((changes, area) => {
			      if (area === 'local' && (changes[E621_CONSTANTS.STORAGE_KEYS.TAG_SCRIPT_QUEUE] || changes[E621_CONSTANTS.STORAGE_KEYS.QUEUE_SLOT_TIMESTAMPS])) {
			        refresh();
			      }
			    });
			
			    Layout.onLayoutSettingsChange((next) => {
			      Layout.applyLayoutVars(pageRoot, next);
			    });
			  }
			
			  async function init() {
			    if (isTimeoutedPage()) {
			      await renderPage();
			    }
			  }
			
			  return { init, renderPage };
			});
			// END: scripts/tag_script/timeouted_page.js
			
			// START: scripts/tag_script/logger.js
			if (false) {
			  E621X.define('tagScriptLogger', ['utils'], (U) => {
			    'use strict';
			
			    const LOG_LIMIT = 1000;
			    const logs = [];
			
			    function formatLogTime(d = new Date()) {
			      const pad = (n, len = 2) => String(n).padStart(len, '0');
			      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
			             `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
			    }
			
			    function add(type, event, reaction, details = {}) {
			      const entry = {
			        time: formatLogTime(),
			        type,       // 'KEYBOARD' | 'CLICK' | 'STATE_CHANGE' | 'ACTION'
			        event,
			        reaction,
			        ...details
			      };
			      logs.push(entry);
			      if (logs.length > LOG_LIMIT) logs.shift();
			      return entry;
			    }
			
			    function key(e, reaction, extra = {}) {
			      const targetDesc = e.target ? `${e.target.tagName.toLowerCase()}${e.target.id ? '#' + e.target.id : ''}${e.target.className ? '.' + String(e.target.className).trim().split(/\s+/).join('.') : ''}` : 'none';
			      const mods = [];
			      if (e.ctrlKey) mods.push('Ctrl');
			      if (e.altKey) mods.push('Alt');
			      if (e.shiftKey) mods.push('Shift');
			      if (e.metaKey) mods.push('Meta');
			      const modStr = mods.length ? ` [${mods.join('+')}]` : '';
			
			      return add('KEYBOARD', `Key '${e.key}'${modStr} on <${targetDesc}>`, reaction, {
			        key: e.key,
			        code: e.code,
			        target: targetDesc,
			        activeElement: document.activeElement ? document.activeElement.tagName : 'none',
			        ...extra
			      });
			    }
			
			    function click(e, reaction, extra = {}) {
			      const target = e.target;
			      const desc = target ? `${target.tagName.toLowerCase()}${target.id ? '#' + target.id : ''}${target.className ? '.' + String(target.className).trim().split(/\s+/).join('.') : ''}` : 'unknown';
			      const text = target?.textContent ? target.textContent.trim().slice(0, 30) : '';
			
			      return add('CLICK', `Click on <${desc}>${text ? ` ("${text}")` : ''}`, reaction, {
			        target: desc,
			        text,
			        ...extra
			      });
			    }
			
			    function valueChange(prop, oldValue, newValue, source, extra = {}) {
			      return add('STATE_CHANGE', `${prop} changed`, `[${source}] ${JSON.stringify(oldValue)} ➔ ${JSON.stringify(newValue)}`, {
			        property: prop,
			        oldValue,
			        newValue,
			        source,
			        ...extra
			      });
			    }
			
			    function action(name, status, details = {}) {
			      return add('ACTION', `fn: ${name}`, status, details);
			    }
			
			    function getFormattedLogText() {
			      if (!logs.length) return '=== Tag Script Diagnostic Log is empty ===';
			      const lines = ['=== Tag Script Diagnostic Log ==='];
			      logs.forEach((l) => {
			        lines.push(`[${l.time}] [${l.type}] ${l.event} => ${l.reaction}`);
			        if (l.source) lines.push(`    Source: ${l.source}`);
			        if (l.property) lines.push(`    Change: ${l.property} = ${JSON.stringify(l.oldValue)} -> ${JSON.stringify(l.newValue)}`);
			      });
			      return lines.join('\n');
			    }
			
			    function tagscriptLog() {
			      if (!logs.length) {
			        console.log('%c[e621 extras] Tag script log is empty.', 'color: #888');
			        return [];
			      }
			      console.group(`%c[e621 extras] Tag Script Diagnostic Log (${logs.length} entries)`, 'color: #3b82f6; font-weight: bold;');
			      console.table(logs.map(l => ({
			        Time: l.time,
			        Type: l.type,
			        Event: l.event,
			        Reaction: l.reaction,
			        Source: l.source || l.property || ''
			      })));
			      console.groupEnd();
			      return logs;
			    }
			
			    tagscriptLog.raw = () => logs;
			    tagscriptLog.text = getFormattedLogText;
			    tagscriptLog.clear = () => {
			      logs.length = 0;
			      console.log('[e621 extras] Tag script log cleared.');
			    };
			    tagscriptLog.export = () => {
			      const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
			      U.downloadBlob(blob, `tagscript_log_${Date.now()}.json`);
			    };
			
			    globalThis.tagscriptLog = tagscriptLog;
			    if (typeof window !== 'undefined') window.tagscriptLog = tagscriptLog;
			
			    setInterval(() => {tagscriptLog()},5000)
			
			    return { add, key, click, valueChange, action, tagscriptLog };
			  });
			} else {
			  E621X.define('tagScriptLogger', [], () => {
			    'use strict';
			    const noop = () => {};
			    const disabledFn = () => {
			      console.log('[e621 extras] Tag script logging is disabled.');
			      return [];
			    };
			    disabledFn.raw = () => [];
			    disabledFn.text = () => 'Logging is disabled.';
			    disabledFn.clear = noop;
			    disabledFn.export = noop;
			
			    globalThis.tagscriptLog = disabledFn;
			    if (typeof window !== 'undefined') window.tagscriptLog = disabledFn;
			
			    return {
			      add: noop,
			      key: noop,
			      click: noop,
			      valueChange: noop,
			      action: noop,
			      tagscriptLog: disabledFn
			    };
			  });
			}
			// END: scripts/tag_script/logger.js
			
			// START: scripts/tag_script/storage.js
			/* Storage & cookie persistence for tag script slots (1-9), presets, and sticky keys.
			 * Tab-specific state (active slots 1-9, active preset, sticky state) is isolated per-tab
			 * via sessionStorage with automatic seeding, preventing cross-tab preset overwrites. */
			E621X.define('tagScriptStorage', ['utils', 'tagScriptLogger'], (U, Log) => {
			  'use strict';
			
			  const LS = {
			    CURRENT_ID: 'current_tag_script_id',
			    scriptKey: (id) => `tag-script-${id}`,
			    STICKY: 'e621_tag_script_sticky',
			    ACTIVE_STICKY_SLOTS: 'e621_tag_script_active_sticky_slots',
			    SLOT_BEFORE_STICKY: 'e621_tag_script_slot_before_sticky',
			    PRESETS: 'e621_tag_script_presets',
			    ACTIVE_PRESET: 'e621_tag_script_active_preset'
			  };
			
			  const TAB_SEEDED_KEY = 'e621_tag_script_tab_seeded';
			
			  function getCookie(name) {
			    const match = document.cookie.match(
			      new RegExp('(?:^|;\\s*)' + name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&') + '=([^;]*)')
			    );
			    return match ? decodeURIComponent(match[1]) : null;
			  }
			
			  function getStoredPresets() {
			    try {
			      const raw = localStorage.getItem(LS.PRESETS);
			      if (!raw) return [];
			      const parsed = JSON.parse(raw);
			      return Array.isArray(parsed) ? parsed : [];
			    } catch (err) {
			      U.logWarn('getStoredPresets', err);
			      return [];
			    }
			  }
			
			  function saveStoredPresets(presets, source = 'unknown') {
			    try {
			      const oldPresets = getStoredPresets();
			      localStorage.setItem(LS.PRESETS, JSON.stringify(presets));
			      Log.valueChange('presets_list', oldPresets.map(p => p.name), presets.map(p => p.name), source);
			    } catch (err) {
			      U.logWarn('saveStoredPresets', err);
			    }
			  }
			
			  /* Ensures this browser tab has its own isolated copy of active scripts & state in sessionStorage. */
			  function ensureTabStorageSeeded() {
			    try {
			      if (sessionStorage.getItem(TAB_SEEDED_KEY)) return;
			
			      const activePreset = localStorage.getItem(LS.ACTIVE_PRESET) || '';
			      sessionStorage.setItem(LS.ACTIVE_PRESET, activePreset);
			
			      const presets = getStoredPresets();
			      const matchedPreset = activePreset
			        ? presets.find(p => p.name.toLowerCase() === activePreset.toLowerCase())
			        : null;
			
			      for (let i = 1; i <= 9; i++) {
			        const key = LS.scriptKey(i);
			        let script = '';
			        if (matchedPreset && matchedPreset.scripts) {
			          script = matchedPreset.scripts[i] || '';
			        } else {
			          script = localStorage.getItem(key) || getCookie(key) || '';
			        }
			        sessionStorage.setItem(key, script);
			      }
			
			      const sticky = (matchedPreset && typeof matchedPreset.sticky === 'boolean')
			        ? String(matchedPreset.sticky)
			        : (localStorage.getItem(LS.STICKY) || 'false');
			      sessionStorage.setItem(LS.STICKY, sticky);
			
			      const activeStickySlots = localStorage.getItem(LS.ACTIVE_STICKY_SLOTS) || '[]';
			      sessionStorage.setItem(LS.ACTIVE_STICKY_SLOTS, activeStickySlots);
			
			      const curId = localStorage.getItem(LS.CURRENT_ID) || '1';
			      sessionStorage.setItem(LS.CURRENT_ID, curId);
			
			      const slotBeforeSticky = localStorage.getItem(LS.SLOT_BEFORE_STICKY) || '1';
			      sessionStorage.setItem(LS.SLOT_BEFORE_STICKY, slotBeforeSticky);
			
			      sessionStorage.setItem(TAB_SEEDED_KEY, 'true');
			    } catch (err) {
			      U.logWarn('ensureTabStorageSeeded', err);
			    }
			  }
			
			  function tabGet(key, fallback = null) {
			    ensureTabStorageSeeded();
			    try {
			      const sVal = sessionStorage.getItem(key);
			      if (sVal !== null && sVal !== undefined) return sVal;
			    } catch (_) {
			      // sessionStorage unavailable
			    }
			
			    try {
			      const lVal = localStorage.getItem(key);
			      if (lVal !== null && lVal !== undefined) return lVal;
			    } catch (_) {
			      // localStorage unavailable
			    }
			
			    return fallback;
			  }
			
			  function tabSet(key, value, syncToLocal = false) {
			    ensureTabStorageSeeded();
			    const str = String(value ?? '');
			    try {
			      sessionStorage.setItem(key, str);
			    } catch (_) {
			      // sessionStorage unavailable
			    }
			
			    if (syncToLocal) {
			      try {
			        localStorage.setItem(key, str);
			      } catch (_) {
			        // localStorage unavailable
			      }
			    }
			  }
			
			  function tabRemove(key, removeFromLocal = false) {
			    ensureTabStorageSeeded();
			    try {
			      sessionStorage.removeItem(key);
			    } catch (_) {
			      // sessionStorage unavailable
			    }
			    if (removeFromLocal) {
			      try {
			        localStorage.removeItem(key);
			      } catch (_) {
			        // localStorage unavailable
			      }
			    }
			  }
			
			  function getCurrentScriptId() {
			    let id = parseInt(tabGet(LS.CURRENT_ID, '1'), 10);
			    return (id >= 1 && id <= 10) ? id : 1;
			  }
			
			  function setCurrentScriptId(id, source = 'unknown') {
			    const num = (id >= 1 && id <= 10) ? id : 1;
			    const oldId = getCurrentScriptId();
			    const str = String(num);
			    tabSet(LS.CURRENT_ID, str, true);
			    if (oldId !== num) {
			      Log.valueChange('current_tag_script_id', oldId, num, source);
			    }
			  }
			
			  function getStoredScript(id) {
			    const num = (id >= 1 && id <= 9) ? id : null;
			    if (!num) return ''; // Slot 10 has no script
			    const key = LS.scriptKey(num);
			    const val = tabGet(key);
			    return val !== null && val !== undefined ? val : '';
			  }
			
			  function setStoredScript(id, content, source = 'unknown', shouldSyncPreset = false) {
			    if (id < 1 || id > 9) return; // Slot 10 is virtual, never persist
			    const key = LS.scriptKey(id);
			    const oldVal = getStoredScript(id);
			    const text = String(content ?? '');
			    if (oldVal !== text) {
			      const hasActivePreset = Boolean(getActivePresetName());
			      tabSet(key, text, !hasActivePreset);
			      Log.valueChange(`slot_${id} (${key})`, oldVal, text, source);
			    }
			    if (shouldSyncPreset) {
			      syncActivePresetScript(id, text, source);
			    }
			  }
			
			  function clearAllStoredScripts(source = 'unknown') {
			    setActivePresetName('', source);
			    for (let i = 1; i <= 9; i++) {
			      setStoredScript(i, '', `${source} -> slot #${i}`, false);
			    }
			  }
			
			  const getActivePresetName = () => tabGet(LS.ACTIVE_PRESET, '') || '';
			
			  const setActivePresetName = (name, source = 'unknown') => {
			    const oldName = getActivePresetName();
			    const nextName = String(name || '');
			    if (oldName !== nextName) {
			      if (!nextName) tabRemove(LS.ACTIVE_PRESET, true);
			      else tabSet(LS.ACTIVE_PRESET, nextName, true);
			      Log.valueChange('active_preset', oldName, nextName, source);
			    }
			  };
			
			  function syncActivePresetScript(id, content, source) {
			    const activeName = getActivePresetName();
			    if (!activeName) return;
			
			    const presets = getStoredPresets();
			    const preset = presets.find(p => p.name.toLowerCase() === activeName.toLowerCase());
			    if (!preset) return;
			
			    if (!preset.scripts) preset.scripts = {};
			    const text = String(content || '').trim();
			    if (text) {
			      preset.scripts[id] = text;
			    } else {
			      delete preset.scripts[id];
			    }
			
			    saveStoredPresets(presets, `syncActivePresetScript("${activeName}" -> slot #${id} via ${source})`);
			  }
			
			  /* Sticky keys mode helpers */
			  const isStickyMode = () => tabGet(LS.STICKY, 'false') === 'true';
			
			  const setStickyMode = (value, source = 'unknown') => {
			    const oldVal = isStickyMode();
			    const nextVal = Boolean(value);
			    if (oldVal !== nextVal) {
			      tabSet(LS.STICKY, String(nextVal), true);
			      Log.valueChange('sticky_mode', oldVal, nextVal, source);
			    }
			  };
			
			  function getActiveStickySlots() {
			    try {
			      const raw = tabGet(LS.ACTIVE_STICKY_SLOTS);
			      if (!raw) return [];
			      const parsed = JSON.parse(raw);
			      return Array.isArray(parsed) ? parsed.map(Number).filter(n => n >= 1 && n <= 9) : [];
			    } catch (_) {
			      return [];
			    }
			  }
			
			  function setActiveStickySlots(slots, source = 'unknown') {
			    const valid = Array.from(new Set(slots.map(Number).filter(n => n >= 1 && n <= 9))).sort((a, b) => a - b);
			    tabSet(LS.ACTIVE_STICKY_SLOTS, JSON.stringify(valid), false);
			    Log.valueChange('active_sticky_slots', [], valid, source);
			  }
			
			  function getSlotBeforeSticky() {
			    const val = parseInt(tabGet(LS.SLOT_BEFORE_STICKY, '1'), 10);
			    return (val >= 1 && val <= 9) ? val : 1;
			  }
			
			  function setSlotBeforeSticky(slot) {
			    const val = (slot >= 1 && slot <= 9) ? slot : 1;
			    tabSet(LS.SLOT_BEFORE_STICKY, String(val), false);
			  }
			
			  function hasAnyScripts(activeFieldVal = '') {
			    if (activeFieldVal && activeFieldVal.trim()) return true;
			    for (let i = 1; i <= 9; i++) {
			      if (getStoredScript(i).trim()) return true;
			    }
			    return false;
			  }
			
			  return {
			    getCurrentScriptId,
			    setCurrentScriptId,
			    getStoredScript,
			    setStoredScript,
			    clearAllStoredScripts,
			    getStoredPresets,
			    saveStoredPresets,
			    getActivePresetName,
			    setActivePresetName,
			    syncActivePresetScript,
			    isStickyMode,
			    setStickyMode,
			    getActiveStickySlots,
			    setActiveStickySlots,
			    getSlotBeforeSticky,
			    setSlotBeforeSticky,
			    hasAnyScripts
			  };
			});
			// END: scripts/tag_script/storage.js
			
			// START: scripts/tag_script/runner.js
			/* Execution engine: applies tag scripts to single posts or bulk selections.
			 * In Sticky Keys mode, multiple active tag scripts are combined and executed in a single request. */
			E621X.define('tagScriptRunner',
			  ['utils', 'selectors', 'net', 'tagScriptEngine', 'tagScriptQueue', 'tagScriptStorage', 'tagScriptLogger'],
			  (U, SEL, Net, Engine, Queue, Storage, Log) => {
			  'use strict';
			
			  const PLAN_PREVIEW_COUNT = 5;
			  const QUEUE_LINK_ID = 'e621x-tag-script-queue-link';
			
			  let bulkRunning = false;
			  const inFlight = new Set();
			  const updatedPostIds = new Set();
			  const lockedPostIds = new Set();
			
			  function onPostStatus(postId, status, error = '') {
			    const id = String(postId);
			    const thumb = document.querySelector(`article.thumbnail[data-id="${id}"]`);
			
			    if (status === 'updated') {
			      updatedPostIds.add(id);
			      lockedPostIds.delete(id);
			      if (thumb) {
			        thumb.classList.remove('e621x-thumb-queued', 'e621x-thumb-locked');
			        thumb.classList.add('e621x-thumb-updated');
			      }
			      U.showToast(`Post #${id} updated`);
			    } else if (status === 'locked') {
			      lockedPostIds.add(id);
			      updatedPostIds.delete(id);
			      if (thumb) {
			        thumb.classList.remove('e621x-thumb-queued', 'e621x-thumb-updated');
			        thumb.classList.add('e621x-thumb-locked');
			      }
			      U.showToast(`Post #${id} skipped: ${error || 'Locked'}`, true);
			    }
			  }
			
			  const getScriptField = () =>
			    document.getElementById('e621x-tag-script-field') || document.querySelector(SEL.nativeTagScriptField);
			  const getReason = () => document.getElementById('e621x-tag-script-reason')?.value || '';
			
			  function readScript() {
			    if (Storage.isStickyMode()) {
			      const activeSlots = Storage.getActiveStickySlots();
			      if (activeSlots.length > 1) {
			        return activeSlots
			          .slice()
			          .sort((a, b) => a - b)
			          .map(id => Storage.getStoredScript(id).trim())
			          .filter(Boolean)
			          .join(' ');
			      }
			      if (activeSlots.length === 1) {
			        return Storage.getStoredScript(activeSlots[0]).trim();
			      }
			      return '';
			    }
			
			    const curId = Storage.getCurrentScriptId();
			    if (curId === 10) return '';
			
			    return (getScriptField()?.value ?? Storage.getStoredScript(curId)).trim();
			  }
			
			  function postDataFromThumb(thumb) {
			    const d = thumb.dataset || {};
			    const tags = (d.tags || '').split(/\s+/).filter(Boolean);
			    const flags = (d.flags || '').split(/\s+/).filter(Boolean);
			
			    const isDeleted = flags.includes('deleted') || thumb.classList.contains('post-status-deleted');
			    const isPending = flags.includes('pending') || thumb.classList.contains('post-status-pending');
			    const isFlagged = flags.includes('flagged') || thumb.classList.contains('post-status-flagged');
			
			    return {
			      id: Number(d.id || 0),
			      tagsSet: new Set(tags),
			      rating: String(d.rating || 's').toLowerCase(),
			      flags,
			      status: isDeleted ? 'deleted' : (isFlagged ? 'flagged' : (isPending ? 'pending' : 'active')),
			      file_ext: String(d.fileExt || '').toLowerCase(),
			      width: Number(d.width) || 0,
			      height: Number(d.height) || 0,
			      size: Number(d.size) || 0,
			      score: Number(d.score) || 0,
			      fav_count: Number(d.favCount) || 0,
			      comment_count: Number(d.commentCount) || 0,
			      uploader: String(d.uploader || '').toLowerCase(),
			      uploader_id: Number(d.uploaderId) || 0,
			      pools: (d.pools || '').split(/\s+/).map(Number).filter(n => Number.isInteger(n) && n > 0),
			      has_parent: thumb.querySelector('.ribbon.left') !== null || d.hasParent === 'true',
			      has_children: thumb.querySelector('.ribbon.right') !== null || d.hasChildren === 'true'
			    };
			  }
			
			  async function sendTagScript(postId, changes, reason) {
			    const res = await Net.sendForm(`/posts/${postId}.json`, 'PATCH', {
			      'post[tag_string_diff]': changes,
			      'post[edit_reason]': reason
			    }, { retries: 1 });
			    if (!res.ok) {
			      const msg = await Queue.parseErrorBody(res);
			      const err = new Error(msg);
			      err.status = res.status;
			      err.response = res;
			      throw err;
			    }
			    return res.json();
			  }
			
			  function applyLocalTagDiff(currentTagString, diffString) {
			    const tags = new Set(String(currentTagString || '').split(/\s+/).filter(Boolean));
			    const tokens = diffString.split(/\s+/).filter(Boolean);
			    for (const token of tokens) {
			      if (token.startsWith('-')) {
			        tags.delete(token.slice(1).toLowerCase());
			      } else if (!token.includes(':')) {
			        tags.add(token.toLowerCase());
			      }
			    }
			    return Array.from(tags).join(' ');
			  }
			
			  function refreshThumbnail(thumb, postId, responseData, changes) {
			    const post = responseData?.post || responseData;
			    const tags = U.getPostTagString(post) || (changes ? applyLocalTagDiff(thumb.dataset.tags, changes) : '');
			
			    if (!tags) return false;
			    thumb.dataset.tags = tags;
			
			    const ratingMatch = changes?.match(/(?:^|\s)[-+]?rating:([sqe])/i);
			    if (ratingMatch) thumb.dataset.rating = ratingMatch[1].toLowerCase();
			    else if (post?.rating) thumb.dataset.rating = post.rating;
			
			    return true;
			  }
			
			  async function syncQueuedOutlines() {
			    const queue = await Queue.getQueue();
			    const queuedIds = new Set(Object.keys(queue).map(String));
			
			    document.querySelectorAll(SEL.thumbnail).forEach(thumb => {
			      const id = String(thumb.dataset.id);
			      const isQueued = queuedIds.has(id);
			      const wasQueued = thumb.classList.contains('e621x-thumb-queued');
			
			      if (isQueued) {
			        thumb.classList.remove('e621x-thumb-updated', 'e621x-thumb-locked');
			        thumb.classList.add('e621x-thumb-queued');
			      } else {
			        thumb.classList.remove('e621x-thumb-queued');
			
			        // If the post was queued on this page and is now finished, turn outline green
			        if (updatedPostIds.has(id) || wasQueued) {
			          if (!lockedPostIds.has(id)) {
			            thumb.classList.remove('e621x-thumb-locked');
			            thumb.classList.add('e621x-thumb-updated');
			            updatedPostIds.add(id);
			          } else {
			            thumb.classList.remove('e621x-thumb-updated');
			            thumb.classList.add('e621x-thumb-locked');
			          }
			        }
			      }
			    });
			
			    const link = document.getElementById(QUEUE_LINK_ID);
			    if (link) {
			      const count = queuedIds.size;
			      link.textContent = `Queue (${count})`;
			      link.classList.toggle('hidden', count === 0 && !(await Queue.isEnabled()));
			    }
			  }
			
			  async function handleThumbClick(thumb) {
			    const postId = thumb.dataset.id;
			    Log.click({ target: thumb }, `Thumbnail click for post #${postId}`);
			    if (bulkRunning) return U.showToast('A bulk tag script is running — please wait', true);
			    if (inFlight.has(postId)) return;
			
			    const script = readScript();
			    if (!script) return U.showToast('Tag script is empty', true);
			
			    const postData = postDataFromThumb(thumb);
			
			    if (postData.status === 'deleted' || postData.flags.includes('status_locked')) {
			      thumb.classList.remove('e621x-thumb-updated', 'e621x-thumb-queued');
			      thumb.classList.add('e621x-thumb-locked');
			      const reason = postData.status === 'deleted' ? 'Post is deleted' : 'Post is status locked';
			      return U.showToast(`Post #${postId} cannot be edited: ${reason}`, true);
			    }
			
			    const changes = Engine.runTagScript(postData, script);
			    if (!changes.trim()) return U.showToast(`Post #${postId}: No changes needed`);
			
			    const queueEnabled = await Queue.isEnabled();
			    const queueCount = await Queue.getQueueCount();
			    const isTimeout = await Queue.isTimeoutActive();
			
			    // If queue is non-empty, do not attempt immediate edit or slot check: append directly to queue
			    if (queueEnabled && (queueCount > 0 || isTimeout)) {
			      await Queue.enqueueFromThumb(thumb, {
			        changes,
			        reason: getReason()
			      });
			      thumb.classList.remove('e621x-thumb-updated', 'e621x-thumb-locked');
			      thumb.classList.add('e621x-thumb-queued');
			      thumb.dataset.tags = applyLocalTagDiff(thumb.dataset.tags, changes);
			      const remMs = await Queue.getRemainingTimeoutMs();
			      U.showToast(queueCount > 0
			        ? `Added to queue (#${postId}). Position: ${queueCount + 1}`
			        : `Hourly limit active. Post #${postId} queued (${Queue.formatDuration(remMs)} left).`);
			      await syncQueuedOutlines();
			      return;
			    }
			
			    inFlight.add(postId);
			    try {
			      U.showToast(`Updating post #${postId}...`);
			      try {
			        const data = await sendTagScript(postId, changes, getReason());
			        refreshThumbnail(thumb, postId, data, changes);
			        thumb.classList.remove('e621x-thumb-queued', 'e621x-thumb-locked');
			        thumb.classList.add('e621x-thumb-updated');
			        await Queue.dequeue(postId);
			        U.showToast(`Post #${postId} updated`);
			      } catch (err) {
			        if (queueEnabled && Queue.isHourlyLimitResponse(err.status, err.message)) {
			          const check = await Queue.verifyHourlyLimitExceeded();
			          if (check.isLimit || err.status === 429) {
			            const duration = check.isLimit ? check.nextAvailableMs : (60 * 1000);
			            await Queue.setTimeoutUntil(Date.now() + duration);
			            await Queue.enqueueFromThumb(thumb, {
			              changes,
			              reason: getReason()
			            });
			            thumb.classList.remove('e621x-thumb-updated', 'e621x-thumb-locked');
			            thumb.classList.add('e621x-thumb-queued');
			            thumb.dataset.tags = applyLocalTagDiff(thumb.dataset.tags, changes);
			            U.showToast(`Hourly limit reached. Post #${postId} queued for ${Queue.formatDuration(duration)}.`, true);
			            await syncQueuedOutlines();
			            return;
			          }
			        }
			
			        const isLockedMsg = /locked|is deleted|cannot be edited/i.test(err.message);
			        let lockReason = isLockedMsg ? err.message : '';
			        if (!isLockedMsg) {
			          const lockCheck = await Queue.checkPostLockStatus(postId, changes);
			          if (lockCheck.isLocked) lockReason = lockCheck.reason;
			        }
			
			        if (lockReason) {
			          thumb.classList.remove('e621x-thumb-queued', 'e621x-thumb-updated');
			          thumb.classList.add('e621x-thumb-locked');
			          U.showToast(`Post #${postId} cannot be edited: ${lockReason}`, true);
			          return;
			        }
			
			        throw err;
			      }
			    } catch (err) {
			      U.showToast(`Error #${postId}: ${err.message}`, true);
			    } finally {
			      inFlight.delete(postId);
			    }
			  }
			
			  function buildPlan(thumbs, script) {
			    const items = [];
			    let skipped = 0;
			
			    for (let i = 0; i < thumbs.length; i++) {
			      const thumb = thumbs[i];
			      try {
			        const postData = postDataFromThumb(thumb);
			        if (postData.status === 'deleted' || postData.flags.includes('status_locked')) {
			          skipped++;
			          continue;
			        }
			        const changes = Engine.runTagScript(postData, script).trim();
			        if (changes) items.push({ thumb, id: thumb.dataset.id, changes });
			      } catch (err) {
			        skipped++;
			        U.logWarn(`checking post #${thumb.dataset.id}`, err);
			      }
			    }
			    return { items, skipped };
			  }
			
			  function formatPlanSummary(plan, total) {
			    const truncate = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
			    const lines = [`${plan.items.length} of ${total} posts will be edited.`];
			    if (plan.skipped) lines.push(`${plan.skipped} posts could not be checked and will be skipped.`);
			    lines.push('');
			    plan.items.slice(0, PLAN_PREVIEW_COUNT).forEach(({ id, changes }) => lines.push(`#${id}: ${truncate(changes, 80)}`));
			    if (plan.items.length > PLAN_PREVIEW_COUNT) lines.push(`…and ${plan.items.length - PLAN_PREVIEW_COUNT} more`);
			    lines.push('', 'Apply the tag script?');
			    return lines.join('\n');
			  }
			
			  async function applyPlan(items, reason) {
			    const queueEnabled = await Queue.isEnabled();
			    let updated = 0;
			    let errors = 0;
			
			    for (let i = 0; i < items.length; i++) {
			      const { thumb, id, changes } = items[i];
			      U.showToast(`Applying ${i + 1}/${items.length}...`);
			      try {
			        const data = await sendTagScript(id, changes, reason);
			        refreshThumbnail(thumb, id, data);
			        thumb.classList.remove('e621x-thumb-queued', 'e621x-thumb-locked');
			        thumb.classList.add('e621x-thumb-updated');
			        await Queue.dequeue(id);
			        updated++;
			      } catch (err) {
			        if (queueEnabled && Queue.isHourlyLimitResponse(err.status, err.message)) {
			          const check = await Queue.verifyHourlyLimitExceeded();
			          if (check.isLimit || err.status === 429) {
			            const duration = check.isLimit ? check.nextAvailableMs : (60 * 1000);
			
			            for (let j = i; j < items.length; j++) {
			              const rem = items[j];
			              await Queue.enqueueFromThumb(rem.thumb, {
			                changes: rem.changes,
			                reason
			              });
			              rem.thumb.classList.remove('e621x-thumb-updated', 'e621x-thumb-locked');
			              rem.thumb.classList.add('e621x-thumb-queued');
			              rem.thumb.dataset.tags = applyLocalTagDiff(rem.thumb.dataset.tags, rem.changes);
			            }
			
			            await Queue.setTimeoutUntil(Date.now() + duration);
			            U.showToast(`Limit reached at post #${id}. Queued remaining ${items.length - i} posts (${Queue.formatDuration(duration)} left).`, true);
			            await syncQueuedOutlines();
			            return;
			          }
			        }
			
			        const isLockedMsg = /locked|is deleted|cannot be edited/i.test(err.message);
			        let lockReason = isLockedMsg ? err.message : '';
			        if (!isLockedMsg) {
			          const lockCheck = await Queue.checkPostLockStatus(id, changes);
			          if (lockCheck.isLocked) lockReason = lockCheck.reason;
			        }
			
			        if (lockReason) {
			          thumb.classList.remove('e621x-thumb-queued', 'e621x-thumb-updated');
			          thumb.classList.add('e621x-thumb-locked');
			          U.showToast(`Post #${id} skipped: ${lockReason}`, true);
			          errors++;
			          continue;
			        }
			
			        errors++;
			        U.logWarn(`updating post #${id}`, err);
			      }
			    }
			    U.showToast(`Tag Script applied: ${updated} updated${errors ? `, ${errors} errors` : ''}`, errors > 0);
			  }
			
			  async function handleApplyAll() {
			    Log.action('handleApplyAll', 'Apply all button triggered');
			    if (bulkRunning) return;
			    const script = readScript();
			    if (!script) return U.showToast('Tag script is empty', true);
			
			    const thumbs = Array.from(document.querySelectorAll(SEL.thumbnail));
			    if (!thumbs.length) return U.showToast('No posts found on this page', true);
			
			    bulkRunning = true;
			    try {
			      const plan = await buildPlan(thumbs, script);
			      if (!plan) return;
			      if (!plan.items.length) return U.showToast('No changes needed');
			
			      const queueEnabled = await Queue.isEnabled();
			      const queueCount = await Queue.getQueueCount();
			      const isTimeout = await Queue.isTimeoutActive();
			
			      // If queue already has items or timeout is active, enqueue all without checking slots
			      if (queueEnabled && (queueCount > 0 || isTimeout)) {
			        for (const item of plan.items) {
			          await Queue.enqueueFromThumb(item.thumb, {
			            changes: item.changes,
			            reason: getReason()
			          });
			          item.thumb.classList.add('e621x-thumb-queued');
			          item.thumb.dataset.tags = applyLocalTagDiff(item.thumb.dataset.tags, item.changes);
			        }
			        U.showToast(`Queued ${plan.items.length} posts`);
			        await syncQueuedOutlines();
			        return;
			      }
			
			      if (!confirm(formatPlanSummary(plan, thumbs.length))) return;
			      await applyPlan(plan.items, getReason());
			    } catch (err) {
			      U.showToast(`Error: ${err.message}`, true);
			    } finally {
			      bulkRunning = false;
			      await syncQueuedOutlines();
			    }
			  }
			
			  return {
			    postDataFromThumb,
			    sendTagScript,
			    applyLocalTagDiff,
			    refreshThumbnail,
			    syncQueuedOutlines,
			    handleThumbClick,
			    handleApplyAll,
			    readScript,
			    getScriptField,
			    getReason,
			    onPostStatus
			  };
			});
			// END: scripts/tag_script/runner.js
			
			// START: scripts/tag_script/preview.js
			/* Rendered preview tooltip of active tag scripts on holding/toggling CTRL.
			 * Smoothly follows cursor matching display refresh rate or custom FPS limit.
			 * Automatically mirrors to opposite side when Hover Zoom is active to avoid collisions. */
			E621X.define('tagScriptPreview', ['utils', 'selectors', 'net', 'dom', 'tagScriptStorage', 'tagScriptRunner'], (U, SEL, Net, D, Storage, Runner) => {
			  'use strict';
			  const { STORAGE_KEYS: KEYS } = E621_CONSTANTS;
			
			  const TOOLTIP_ID = 'e621x-ts-preview';
			  const VIEWPORT_MARGIN = 12;
			  const CURSOR_OFFSET_X = 24;
			
			  const clamp = (val, min, max) => Math.min(Math.max(val, min), max);
			
			  const tagCategoryCache = new Map();
			  const inFlightTags = new Set();
			
			  let tooltipEl = null;
			  let isCtrlDown = false;
			  let isStickyCtrl = false;
			  let targetFps = 0; // 0 = native monitor refresh rate via requestAnimationFrame
			  let scheduled = false;
			  let lastTime = 0;
			  let lastClientX = 0;
			  let lastClientY = 0;
			
			  function isTagScriptMode() {
			    const select = document.querySelector(SEL.modeSelect);
			    return select?.value === 'tag-script-ext';
			  }
			
			  function collectPageTags() {
			    document.querySelectorAll('#tag-list li[class*="tag-type-"]').forEach(li => {
			      const match = li.className.match(/tag-type-(\d+)/);
			      const tagLink = li.querySelector('a.search-tag, a');
			      if (match && tagLink) {
			        const cat = Number(match[1]);
			        const name = tagLink.textContent.trim().toLowerCase().replace(/\s+/g, '_');
			        if (name) tagCategoryCache.set(name, cat);
			      }
			    });
			  }
			
			  async function fetchMissingTags(tagNames) {
			    const missing = tagNames.filter(t => !tagCategoryCache.has(t) && !inFlightTags.has(t));
			    if (!missing.length) return;
			
			    missing.forEach(t => inFlightTags.add(t));
			    try {
			      const url = `/tags.json?search[name]=${encodeURIComponent(missing.join(','))}&limit=100`;
			      const data = await Net.fetchJson(url);
			      const list = Array.isArray(data) ? data : (data?.tags || []);
			      list.forEach(t => {
			        if (t?.name && t.category !== undefined) {
			          tagCategoryCache.set(String(t.name).toLowerCase(), Number(t.category));
			        }
			      });
			      missing.forEach(t => {
			        if (!tagCategoryCache.has(t)) tagCategoryCache.set(t, 0);
			      });
			      if (isCtrlDown && isTagScriptMode() && tooltipEl && !tooltipEl.classList.contains('is-hidden')) {
			        renderPreview();
			      }
			    } catch (_) {
			      missing.forEach(t => tagCategoryCache.set(t, 0));
			    } finally {
			      missing.forEach(t => inFlightTags.delete(t));
			    }
			  }
			
			  function getActiveScripts() {
			    if (Storage.isStickyMode()) {
			      const slots = Storage.getActiveStickySlots();
			      if (!slots.length) return [];
			      return slots
			        .slice()
			        .sort((a, b) => a - b)
			        .map(id => ({ id, text: Storage.getStoredScript(id).trim() }))
			        .filter(s => Boolean(s.text));
			    }
			    const currentId = Storage.getCurrentScriptId();
			    if (currentId === 10) return [];
			    const field = Runner.getScriptField();
			    const text = (field ? field.value : Storage.getStoredScript(currentId)).trim();
			    return text ? [{ id: currentId, text }] : [];
			  }
			
			  function formatScriptLine(scriptText) {
			    const tokens = String(scriptText || '').trim().split(/\s+/).filter(Boolean);
			    if (!tokens.length) return '';
			
			    let line = '';
			    let currentLineLen = 0;
			    const missing = [];
			
			    for (let i = 0; i < tokens.length; i++) {
			      const token = tokens[i];
			      let prefix = '';
			      let rawTag = token;
			
			      if (token.startsWith('-') || token.startsWith('+') || token.startsWith('~')) {
			        prefix = token[0];
			        rawTag = token.slice(1);
			      }
			
			      const cleanTag = rawTag.toLowerCase();
			      let catClass = 'e621x-tag-type-general';
			
			      if (token.startsWith('[') && token.endsWith(']')) {
			        catClass = 'e621x-tag-type-command';
			      } else if (rawTag.includes(':')) {
			        catClass = 'e621x-tag-type-meta';
			      } else if (tagCategoryCache.has(cleanTag)) {
			        const cat = tagCategoryCache.get(cleanTag);
			        catClass = `e621x-tag-type-${cat}`;
			      } else {
			        missing.push(cleanTag);
			        catClass = 'e621x-tag-type-0';
			      }
			
			      const tokenHtml = `${prefix ? `<span class="e621x-tag-type-prefix">${prefix}</span>` : ''}<span class="${catClass}">${D.escapeHtml(rawTag)}</span>`;
			      const tokenLen = token.length + (i > 0 ? 1 : 0);
			
			      if (currentLineLen + tokenLen > 80 && currentLineLen > 0) {
			        line += '<br>&nbsp;&nbsp;';
			        currentLineLen = 2;
			      } else if (i > 0) {
			        line += ' ';
			        currentLineLen += 1;
			      }
			
			      line += tokenHtml;
			      currentLineLen += token.length;
			    }
			
			    if (missing.length > 0) {
			      fetchMissingTags(missing);
			    }
			
			    return line;
			  }
			
			  function alignTooltip(clientX, clientY) {
			    if (!tooltipEl || tooltipEl.classList.contains('is-hidden')) return;
			
			    const vw = window.innerWidth;
			    const vh = window.innerHeight;
			    const rect = tooltipEl.getBoundingClientRect();
			    const boxW = rect.width;
			    const boxH = rect.height;
			    if (!boxW || !boxH) return;
			
			    const zoomContainer = document.getElementById('e621x-zoom-container');
			    const isZoomActive = zoomContainer && !zoomContainer.classList.contains('is-hidden');
			
			    const placeOnRight = isZoomActive ? (clientX >= vw / 2) : (clientX < vw / 2);
			
			    let left;
			    if (placeOnRight) {
			      left = clientX + CURSOR_OFFSET_X;
			      if (left + boxW > vw - VIEWPORT_MARGIN) left = vw - boxW - VIEWPORT_MARGIN;
			    } else {
			      left = clientX - boxW - CURSOR_OFFSET_X;
			      if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
			    }
			
			    let top = clamp(clientY - (boxH / 2), VIEWPORT_MARGIN, vh - boxH - VIEWPORT_MARGIN);
			
			    if (left <= clientX + 8 && left + boxW >= clientX - 8) {
			      if (clientY < vh / 2) {
			        top = clamp(clientY + CURSOR_OFFSET_X + 12, VIEWPORT_MARGIN, vh - boxH - VIEWPORT_MARGIN);
			      } else {
			        top = clamp(clientY - boxH - CURSOR_OFFSET_X - 12, VIEWPORT_MARGIN, vh - boxH - VIEWPORT_MARGIN);
			      }
			    }
			
			    tooltipEl.style.left = `${Math.round(left)}px`;
			    tooltipEl.style.top = `${Math.round(top)}px`;
			  }
			
			  function requestAlignTooltip() {
			    if (scheduled) return;
			    scheduled = true;
			
			    const now = performance.now();
			    const minInterval = targetFps > 0 ? (1000 / targetFps) : 0;
			    const wait = Math.max(0, minInterval - (now - lastTime));
			
			    const execute = () => {
			      requestAnimationFrame(() => {
			        scheduled = false;
			        lastTime = performance.now();
			        if (isCtrlDown && isTagScriptMode()) {
			          alignTooltip(lastClientX, lastClientY);
			        }
			      });
			    };
			
			    if (wait > 0) {
			      setTimeout(execute, wait);
			    } else {
			      execute();
			    }
			  }
			
			  function renderPreview() {
			    if (!isTagScriptMode()) {
			      hideTooltip();
			      return;
			    }
			
			    const scripts = getActiveScripts();
			    if (!scripts.length) {
			      hideTooltip();
			      return;
			    }
			
			    if (lastClientX === 0 && lastClientY === 0) {
			      // Coordinates not known yet (e.g. right after reload); wait for cursor movement
			      return;
			    }
			
			    tooltipEl.replaceChildren();
			    for (const script of scripts) {
			      const row = document.createElement('div');
			      row.className = 'e621x-ts-preview-line';
			      row.innerHTML = `<span class="e621x-ts-preview-bullet">•</span>${formatScriptLine(script.text)}`;
			      tooltipEl.appendChild(row);
			    }
			
			    tooltipEl.classList.remove('is-hidden');
			    alignTooltip(lastClientX, lastClientY);
			  }
			
			  function showTooltip() {
			    if (!tooltipEl || !isTagScriptMode()) return;
			    renderPreview();
			  }
			
			  function hideTooltip() {
			    if (!tooltipEl) return;
			    tooltipEl.classList.add('is-hidden');
			    tooltipEl.replaceChildren();
			  }
			
			  function syncPreview() {
			    if (!isTagScriptMode()) {
			      hideTooltip();
			      return;
			    }
			    if (isCtrlDown || (tooltipEl && !tooltipEl.classList.contains('is-hidden'))) {
			      const scripts = getActiveScripts();
			      if (!scripts.length) {
			        hideTooltip();
			        return;
			      }
			      renderPreview();
			    }
			  }
			
			  async function isFeatureEnabled() {
			    return (await U.storageGet(KEYS.CTRL_PREVIEW_ENABLED, true)) !== false;
			  }
			
			  function setupEvents() {
			    const handlePointerActivity = (e) => {
			      lastClientX = e.clientX;
			      lastClientY = e.clientY;
			
			      if (!isCtrlDown || !isTagScriptMode() || !tooltipEl) return;
			
			      if (tooltipEl.classList.contains('is-hidden')) {
			        renderPreview();
			        return;
			      }
			
			      requestAlignTooltip();
			    };
			
			    document.addEventListener('mousemove', handlePointerActivity, { passive: true });
			    document.addEventListener('mouseover', (e) => {
			      if (!isCtrlDown || !isTagScriptMode() || !tooltipEl || !tooltipEl.classList.contains('is-hidden')) return;
			      lastClientX = e.clientX;
			      lastClientY = e.clientY;
			      renderPreview();
			    }, { passive: true });
			
			    document.addEventListener('click', (e) => {
			      if (!isStickyCtrl && !e.ctrlKey && isCtrlDown) {
			        isCtrlDown = false;
			        hideTooltip();
			      }
			    });
			
			    window.addEventListener('e621x-zoom-change', () => {
			      if (isCtrlDown && isTagScriptMode()) {
			        alignTooltip(lastClientX, lastClientY);
			      }
			    });
			
			    window.addEventListener('keydown', async (e) => {
			      if (e.key === 'Escape') {
			        // Sticky Ctrl preview MUST NOT be dismissed or deactivated by Escape
			        if (isStickyCtrl) return;
			
			        if (isCtrlDown || (tooltipEl && !tooltipEl.classList.contains('is-hidden'))) {
			          isCtrlDown = false;
			          hideTooltip();
			          if (document.activeElement?.tagName === 'SELECT') {
			            document.activeElement.blur();
			          }
			        }
			        return;
			      }
			
			      if (['TEXTAREA', 'INPUT'].includes(document.activeElement?.tagName)) return;
			
			      if (e.key !== 'Control' || e.repeat) return;
			      if (!isTagScriptMode()) return;
			      if (!(await isFeatureEnabled())) return;
			
			      if (isStickyCtrl) {
			        isCtrlDown = !isCtrlDown;
			        await U.storageSet(KEYS.CTRL_STICKY_ACTIVE, isCtrlDown);
			        if (isCtrlDown) {
			          showTooltip();
			        } else {
			          hideTooltip();
			        }
			      } else {
			        if (!isCtrlDown) {
			          isCtrlDown = true;
			          showTooltip();
			        }
			      }
			    });
			
			    window.addEventListener('keyup', (e) => {
			      if (e.key !== 'Control') return;
			      if (isStickyCtrl) return;
			
			      isCtrlDown = false;
			      hideTooltip();
			    });
			
			    window.addEventListener('blur', () => {
			      if (isStickyCtrl) return;
			      isCtrlDown = false;
			      hideTooltip();
			    });
			
			    window.addEventListener('focus', () => {
			      if (isStickyCtrl && isCtrlDown && isTagScriptMode()) {
			        alignTooltip(lastClientX, lastClientY);
			      }
			    });
			  }
			
			  async function init() {
			    if (document.getElementById(TOOLTIP_ID)) return;
			
			    tooltipEl = document.createElement('div');
			    tooltipEl.id = TOOLTIP_ID;
			    tooltipEl.className = 'e621x-ts-preview is-hidden';
			    document.body.appendChild(tooltipEl);
			
			    const isEnabled = (await U.storageGet(KEYS.CTRL_PREVIEW_ENABLED, true)) !== false;
			    isStickyCtrl = Boolean(await U.storageGet(KEYS.CTRL_PREVIEW_STICKY, false));
			    if (isEnabled && isStickyCtrl) {
			      isCtrlDown = Boolean(await U.storageGet(KEYS.CTRL_STICKY_ACTIVE, false));
			    } else {
			      isCtrlDown = false;
			    }
			    targetFps = Number(await U.storageGet(KEYS.TRACKING_FPS, 0)) || 0;
			
			    chrome.storage.onChanged.addListener((changes, area) => {
			      if (area === 'local') {
			        if (changes[KEYS.CTRL_PREVIEW_STICKY] !== undefined) {
			          isStickyCtrl = Boolean(changes[KEYS.CTRL_PREVIEW_STICKY].newValue);
			          if (!isStickyCtrl && isCtrlDown) {
			            isCtrlDown = false;
			            hideTooltip();
			            U.storageSet(KEYS.CTRL_STICKY_ACTIVE, false);
			          }
			        }
			        if (changes[KEYS.CTRL_PREVIEW_ENABLED] !== undefined && !changes[KEYS.CTRL_PREVIEW_ENABLED].newValue) {
			          isCtrlDown = false;
			          hideTooltip();
			          U.storageSet(KEYS.CTRL_STICKY_ACTIVE, false);
			        }
			        if (changes[KEYS.CTRL_STICKY_ACTIVE] !== undefined && isStickyCtrl) {
			          const nextActive = Boolean(changes[KEYS.CTRL_STICKY_ACTIVE].newValue);
			          if (isCtrlDown !== nextActive) {
			            isCtrlDown = nextActive;
			            if (isCtrlDown) {
			              syncPreview();
			            } else {
			              hideTooltip();
			            }
			          }
			        }
			        if (changes[KEYS.TRACKING_FPS] !== undefined) {
			          targetFps = Number(changes[KEYS.TRACKING_FPS].newValue) || 0;
			        }
			      }
			    });
			
			    collectPageTags();
			    setupEvents();
			  }
			
			  return { init, renderPreview, syncPreview, hideTooltip };
			});
			// END: scripts/tag_script/preview.js
			
			// START: scripts/tag_script/index.js
			/* UI panel, presets management, sticky keys, hotkeys and lifecycle orchestration. */
			E621X.define('tagScript',
			  ['utils', 'selectors', 'tagScriptStorage', 'tagScriptRunner', 'tagScriptPreview', 'tagScriptQueue', 'tagScriptLogger'],
			  (U, SEL, Storage, Runner, Preview, Queue, Log) => {
			  'use strict';
			
			  const IDS = {
			    ui: 'e621x-tag-script-ui',
			    ownField: 'e621x-tag-script-field',
			    reason: 'e621x-tag-script-reason',
			    all: 'e621x-tag-script-all',
			    sticky: 'e621x-tag-script-sticky',
			    presetSelect: 'e621x-tag-script-preset-select',
			    presetName: 'e621x-tag-script-preset-name',
			    presetSave: 'e621x-tag-script-preset-save',
			    presetDelete: 'e621x-tag-script-preset-delete',
			    queueLink: 'e621x-tag-script-queue-link'
			  };
			
			  const MODE_VALUE = 'tag-script-ext';
			
			  let usesNative = false;
			  let isProgrammaticInput = false;
			
			  const getModeSelect = () => document.querySelector(SEL.modeSelect);
			  const isTagScriptMode = () => getModeSelect()?.value === MODE_VALUE;
			
			  function setFieldDisplayValue(val, source) {
			    const field = Runner.getScriptField();
			    if (!field) return;
			    const oldVal = field.value;
			    if (oldVal === val) return;
			    isProgrammaticInput = true;
			    try {
			      field.value = val;
			      Log.valueChange('field.value', oldVal, val, source);
			      field.dispatchEvent(new Event('input', { bubbles: true }));
			      field.dispatchEvent(new Event('change', { bubbles: true }));
			    } finally {
			      isProgrammaticInput = false;
			    }
			  }
			
			  function syncStickyUi() {
			    const field = Runner.getScriptField();
			    if (!field) return;
			
			    if (!Storage.isStickyMode()) {
			      field.disabled = false;
			      const currentId = Storage.getCurrentScriptId();
			      const validId = (currentId >= 1 && currentId <= 9) ? currentId : (Storage.getSlotBeforeSticky() || 1);
			      Storage.setCurrentScriptId(validId, 'syncStickyUi restore');
			      setFieldDisplayValue(Storage.getStoredScript(validId), 'syncStickyUi restore');
			      return;
			    }
			
			    const activeSlots = Storage.getActiveStickySlots();
			    if (activeSlots.length > 0) {
			      field.disabled = true;
			      field.value = `[${activeSlots.sort((a, b) => a - b).join(', ')}] hold ctrl to view tags`;
			      Storage.setCurrentScriptId(10, 'sticky active slots');
			    } else {
			      Storage.setCurrentScriptId(10, 'sticky empty slots');
			      field.disabled = true;
			      field.value = 'Use numbers on keyboard';
			    }
			  }
			
			  function handleClearScripts(source = 'handleClearScripts') {
			    Log.action('handleClearScripts', `Clearing all 9 slots (source: ${source})`);
			    Storage.clearAllStoredScripts(source);
			    Storage.setActiveStickySlots([]);
			
			    const nameInput = document.getElementById(IDS.presetName);
			    if (nameInput) nameInput.value = '';
			
			    if (Storage.isStickyMode()) {
			      Storage.setCurrentScriptId(10, 'cleared in sticky');
			    } else {
			      const restoreSlot = Storage.getSlotBeforeSticky() || 1;
			      Storage.setCurrentScriptId(restoreSlot, 'cleared');
			    }
			
			    syncStickyUi();
			    updatePresetDropdown('');
			    Preview.syncPreview();
			    U.showToast('Tag scripts cleared');
			    Log.add('ACTION', 'handleClearScripts', 'Cleared all 9 tag script slots and active preset');
			  }
			
			  function updatePresetDropdown(selectedName = '') {
			    const select = document.getElementById(IDS.presetSelect);
			    if (!select) return;
			
			    const presets = Storage.getStoredPresets();
			    select.replaceChildren();
			
			    const defaultOpt = document.createElement('option');
			    defaultOpt.value = '';
			    defaultOpt.textContent = 'Select preset...';
			    select.appendChild(defaultOpt);
			
			    const customOpt = document.createElement('option');
			    customOpt.value = '__custom__';
			    customOpt.textContent = 'Select preset...';
			    customOpt.hidden = true;
			    select.appendChild(customOpt);
			
			    let matched = false;
			    presets.forEach(p => {
			      const opt = document.createElement('option');
			      opt.value = p.name;
			      opt.textContent = p.name;
			      if (selectedName && p.name.toLowerCase() === selectedName.toLowerCase()) {
			        opt.selected = true;
			        matched = true;
			      }
			      select.appendChild(opt);
			    });
			
			    if (!matched) {
			      if (selectedName === '__custom__' || (Storage.hasAnyScripts(Runner.getScriptField()?.value) && !selectedName)) {
			        customOpt.selected = true;
			        select.value = '__custom__';
			      } else {
			        defaultOpt.selected = true;
			        select.value = '';
			      }
			    }
			  }
			
			  function handleLoadPreset(name) {
			    Log.action('handleLoadPreset', `Loading preset "${name}"`);
			    if (!name || name === '__clear__') {
			      handleClearScripts('preset dropdown: Select preset...');
			      return;
			    }
			
			    const presets = Storage.getStoredPresets();
			    const preset = presets.find(p => p.name.toLowerCase() === name.toLowerCase());
			    if (!preset) {
			      Log.add('ACTION', 'handleLoadPreset', `Preset "${name}" not found in storage, clearing scripts`);
			      handleClearScripts('preset not found');
			      return;
			    }
			
			    Storage.setActivePresetName(preset.name, `handleLoadPreset("${preset.name}")`);
			    Storage.setActiveStickySlots([]);
			    for (let i = 1; i <= 9; i++) {
			      const scriptContent = preset.scripts?.[i] || '';
			      Storage.setStoredScript(i, scriptContent, `handleLoadPreset("${preset.name}") -> slot #${i}`, false);
			    }
			
			    let currentId = Storage.getCurrentScriptId();
			    const hasCurrent = Boolean(preset.scripts?.[currentId]?.trim());
			    if (!hasCurrent) {
			      if (preset.scripts?.[1]?.trim()) {
			        currentId = 1;
			      } else {
			        const firstSlot = [1, 2, 3, 4, 5, 6, 7, 8, 9].find(slot => Boolean(preset.scripts?.[slot]?.trim()));
			        if (firstSlot) currentId = firstSlot;
			      }
			      Storage.setCurrentScriptId(currentId, `handleLoadPreset("${preset.name}"): auto-select populated slot`);
			    }
			
			    if (Storage.isStickyMode()) {
			      Storage.setCurrentScriptId(10, 'preset loaded in sticky');
			      syncStickyUi();
			    } else {
			      const scriptVal = Storage.getStoredScript(currentId);
			      setFieldDisplayValue(scriptVal, `handleLoadPreset("${preset.name}") for slot #${currentId}`);
			    }
			
			    updatePresetDropdown(preset.name);
			    Preview.syncPreview();
			    U.showToast(`Preset "${preset.name}" loaded`);
			    Log.add('ACTION', 'handleLoadPreset', `Successfully loaded preset "${preset.name}"`);
			  }
			
			  function handleSavePreset() {
			    const nameInput = document.getElementById(IDS.presetName);
			    const name = nameInput?.value.trim();
			
			    if (!name) {
			      U.showToast('Enter a preset name', true);
			      nameInput?.focus();
			      return;
			    }
			
			    const scripts = {};
			    let hasAny = false;
			    for (let i = 1; i <= 9; i++) {
			      const val = Storage.getStoredScript(i).trim();
			      if (val) {
			        scripts[i] = val;
			        hasAny = true;
			      }
			    }
			
			    if (!hasAny) {
			      U.showToast('No tag scripts to save in preset', true);
			      return;
			    }
			
			    const presets = Storage.getStoredPresets();
			    const existingIdx = presets.findIndex(p => p.name.toLowerCase() === name.toLowerCase());
			    const presetData = {
			      name,
			      scripts
			    };
			
			    if (existingIdx >= 0) {
			      presets[existingIdx] = presetData;
			    } else {
			      presets.push(presetData);
			    }
			
			    Storage.saveStoredPresets(presets, `handleSavePreset("${name}")`);
			    Storage.setActivePresetName(name, `handleSavePreset("${name}")`);
			    if (nameInput) nameInput.value = '';
			    updatePresetDropdown(name);
			    U.showToast(`Preset "${name}" saved`);
			  }
			
			  function handleDeletePreset() {
			    Log.action('handleDeletePreset', 'Delete preset button clicked');
			    const select = document.getElementById(IDS.presetSelect);
			    const selectedVal = select?.value;
			    const activeName = Storage.getActivePresetName();
			
			    let targetName = '';
			    if (selectedVal && selectedVal !== '__custom__' && selectedVal !== '__clear__') {
			      targetName = selectedVal;
			    } else if (activeName) {
			      targetName = activeName;
			    }
			
			    if (!targetName) {
			      U.showToast('Select a preset from dropdown to delete', true);
			      Log.add('ACTION', 'handleDeletePreset', 'Failed: No preset selected in dropdown');
			      return;
			    }
			
			    const presets = Storage.getStoredPresets();
			    const idx = presets.findIndex(p => p.name.toLowerCase() === targetName.toLowerCase());
			    if (idx === -1) {
			      U.showToast(`Preset "${targetName}" not found`, true);
			      Log.add('ACTION', 'handleDeletePreset', `Failed: Preset "${targetName}" not found in storage`);
			      return;
			    }
			
			    const deletedName = presets[idx].name;
			    presets.splice(idx, 1);
			    Storage.saveStoredPresets(presets, `handleDeletePreset("${deletedName}")`);
			
			    if (Storage.getActivePresetName().toLowerCase() === deletedName.toLowerCase()) {
			      handleClearScripts(`deleted active preset "${deletedName}"`);
			    } else {
			      updatePresetDropdown(Storage.getActivePresetName());
			      U.showToast(`Preset "${deletedName}" deleted`);
			    }
			
			    const nameInput = document.getElementById(IDS.presetName);
			    if (nameInput && nameInput.value.trim().toLowerCase() === deletedName.toLowerCase()) {
			      nameInput.value = '';
			    }
			    Log.add('ACTION', 'handleDeletePreset', `Successfully deleted preset "${deletedName}"`);
			  }
			
			  function buildUi(withOwnField) {
			    const ui = document.createElement('div');
			    ui.id = IDS.ui;
			    ui.innerHTML = `
			      ${withOwnField ? `<input id="${IDS.ownField}" data-autocomplete="tag-edit" placeholder="Enter tag script" class="st-input e621x-ts-input" />` : ''}
			      <div class="e621x-ts-row">
			        <button id="${IDS.all}" type="button" class="st-button e621x-ts-all">All</button>
			        <input id="${IDS.reason}" placeholder="Reason" maxlength="250" class="st-input e621x-ts-input e621x-ts-grow" />
			      </div>
			      <div class="e621x-ts-row">
			        <select id="${IDS.presetSelect}" class="st-select e621x-ts-input e621x-ts-grow">
			          <option value="">Select preset...</option>
			        </select>
			      </div>
			      <div class="e621x-ts-row">
			        <input id="${IDS.presetName}" placeholder="Preset name" class="st-input e621x-ts-input e621x-ts-grow" />
			        <button id="${IDS.presetSave}" type="button" class="st-button e621x-ts-btn">Save</button>
			        <button id="${IDS.presetDelete}" type="button" class="st-button e621x-ts-btn">Delete</button>
			      </div>
			      <div class="e621x-ts-row e621x-ts-row--spread">
			        <label class="e621x-ts-label" title="Combine multiple active tag scripts in a single request">
			          <input type="checkbox" id="${IDS.sticky}" />
			          <span>Sticky Keys</span>
			        </label>
			        <a id="${IDS.queueLink}" href="/posts/timeouted" target="_blank" class="e621x-ts-queue-link hidden">Queue (0)</a>
			      </div>`;
			    return ui;
			  }
			
			  function injectUI() {
			    const modeBox = document.querySelector(SEL.modeBox);
			    const select = getModeSelect();
			    if (!modeBox || !select) return;
			
			    usesNative = Boolean(document.querySelector(SEL.nativeTagScriptField));
			
			    if (!Array.from(select.options).some(o => o.value === MODE_VALUE)) {
			      select.append(new Option('Tag Script (extension)', MODE_VALUE));
			    }
			    if (document.getElementById(IDS.ui)) return;
			
			    // Always create our dedicated field to keep extension mode isolated from native tag scripts
			    const ui = buildUi(true);
			    modeBox.appendChild(ui);
			
			    const ownField = document.getElementById(IDS.ownField);
			    const stickyCheckbox = document.getElementById(IDS.sticky);
			    const presetSelect = document.getElementById(IDS.presetSelect);
			    const presetNameInput = document.getElementById(IDS.presetName);
			    const presetSaveBtn = document.getElementById(IDS.presetSave);
			    const presetDeleteBtn = document.getElementById(IDS.presetDelete);
			    const allBtn = document.getElementById(IDS.all);
			
			    stickyCheckbox.checked = Storage.isStickyMode();
			    stickyCheckbox.addEventListener('change', (e) => {
			      const isSticky = stickyCheckbox.checked;
			      Storage.setStickyMode(isSticky, 'checkbox change');
			      if (isSticky) {
			        const cur = Storage.getCurrentScriptId();
			        const validCur = cur >= 1 && cur <= 9 ? cur : 1;
			        Storage.setSlotBeforeSticky(validCur);
			
			        const hasScript = Boolean(Storage.getStoredScript(validCur).trim());
			        Storage.setActiveStickySlots(hasScript ? [validCur] : []);
			      } else {
			        Storage.setActiveStickySlots([]);
			        const restoreSlot = Storage.getSlotBeforeSticky();
			        Storage.setCurrentScriptId(restoreSlot, 'sticky disabled');
			      }
			      syncStickyUi();
			      Preview.syncPreview();
			      Log.click(e, `Sticky Keys toggled to ${isSticky ? 'ON' : 'OFF'}`);
			      U.showToast(`Tag Scripts: Sticky Keys ${isSticky ? 'ON' : 'OFF'}`);
			    });
			
			    const activePreset = Storage.getActivePresetName();
			    updatePresetDropdown(activePreset);
			    if (activePreset) {
			      const presets = Storage.getStoredPresets();
			      const matched = presets.find(p => p.name.toLowerCase() === activePreset.toLowerCase());
			      if (!matched) {
			        Storage.setActivePresetName('', 'init unmatched');
			      }
			    }
			
			    presetSelect.addEventListener('change', (e) => {
			      const val = presetSelect.value;
			      Log.click(e, `Preset dropdown selected: "${val}"`);
			      if (!val || val === '__clear__') {
			        handleClearScripts('preset dropdown: Select preset...');
			      } else if (val !== '__custom__') {
			        handleLoadPreset(val);
			      }
			      presetSelect.blur();
			    });
			
			    presetSaveBtn.addEventListener('click', (e) => {
			      e.preventDefault();
			      Log.click(e, 'Save preset button clicked');
			      handleSavePreset();
			    });
			
			    presetDeleteBtn.addEventListener('click', (e) => {
			      e.preventDefault();
			      Log.click(e, 'Delete preset button clicked');
			      handleDeletePreset();
			    });
			
			    presetNameInput.addEventListener('keydown', (e) => {
			      if (e.key === 'Enter') {
			        e.preventDefault();
			        Log.key(e, 'Enter pressed in preset name input -> triggering handleSavePreset');
			        handleSavePreset();
			      }
			    });
			
			    const handleFieldInput = (field, source) => {
			      if (isProgrammaticInput) return;
			      if (Storage.isStickyMode()) return;
			      const val = field.value;
			      if (val.includes('hold ctrl to view tags') || val.includes('Use numbers on')) return;
			
			      const currentId = Storage.getCurrentScriptId();
			      if (currentId >= 1 && currentId <= 9) {
			        Storage.setStoredScript(currentId, val, `user typing in ${source} (slot #${currentId})`, true);
			        Preview.syncPreview();
			      }
			    };
			
			    const nativeField = document.querySelector(SEL.nativeTagScriptField);
			    if (nativeField) {
			      nativeField.addEventListener('input', () => handleFieldInput(nativeField, 'nativeField'));
			    }
			
			    if (ownField) {
			      ownField.addEventListener('input', () => handleFieldInput(ownField, 'ownField'));
			    }
			
			    const syncMode = () => {
			      const active = select.value === MODE_VALUE;
			      ui.classList.toggle('is-visible', active);
			      if (active) {
			        const curPreset = Storage.getActivePresetName();
			        updatePresetDropdown(curPreset);
			        syncStickyUi();
			        if (!Storage.isStickyMode()) {
			          const id = Storage.getCurrentScriptId();
			          const validId = (id >= 1 && id <= 9) ? id : 1;
			          const scriptVal = Storage.getStoredScript(validId);
			          setFieldDisplayValue(scriptVal, 'mode-box switch to tag-script');
			          const field = Runner.getScriptField();
			          if (field) field.focus();
			          U.showToast(`Switched to tag script #${validId}. Use 1-9 keys to switch.`);
			          Log.add('ACTION', 'syncMode', `Activated tag-script mode on slot #${validId}`);
			        }
			        Preview.syncPreview();
			      } else {
			        Preview.hideTooltip();
			      }
			    };
			    select.addEventListener('change', (e) => {
			      Log.click(e, `Mode dropdown changed to "${select.value}"`);
			      syncMode();
			    });
			    if (select.value === MODE_VALUE) syncMode();
			
			    allBtn.addEventListener('click', (e) => {
			      e.preventDefault();
			      Log.click(e, 'All button clicked');
			      Runner.handleApplyAll();
			    });
			
			    Runner.syncQueuedOutlines();
			  }
			
			  function setupThumbnailClickListener() {
			    document.addEventListener('click', (e) => {
			      if (!isTagScriptMode()) return;
			
			      const thumb = e.target.closest(SEL.thumbnail);
			      if (!thumb) return;
			
			      e.preventDefault();
			      e.stopPropagation();
			      Runner.handleThumbClick(thumb);
			    }, true);
			  }
			
			  function setupHotkeys() {
			    window.addEventListener('keydown', (e) => {
			      if (!isTagScriptMode()) return;
			
			      if (['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement?.tagName)) {
			        return;
			      }
			
			      if (Storage.isStickyMode() && e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey) {
			        if (document.querySelector('.e621x-tree-dialog')) return;
			
			        const activeSlots = Storage.getActiveStickySlots();
			        if (activeSlots.length > 0) {
			          e.preventDefault();
			          e.stopPropagation();
			
			          Storage.setActiveStickySlots([], 'hotkey [Escape]');
			          syncStickyUi();
			          Preview.syncPreview();
			          U.showToast('All slots deselected');
			          Log.key(e, 'Escape pressed -> Deselected all active sticky slots');
			          return;
			        }
			      }
			
			      if (!/^[1-9]$/.test(e.key) || e.ctrlKey || e.altKey || e.metaKey) {
			        return;
			      }
			
			      const newId = Number(e.key);
			      e.preventDefault();
			      e.stopPropagation();
			
			      if (Storage.isStickyMode()) {
			        let activeSlots = Storage.getActiveStickySlots();
			        if (activeSlots.includes(newId)) {
			          activeSlots = activeSlots.filter(id => id !== newId);
			          U.showToast(`Slot #${newId} disabled`);
			        } else {
			          if (!Storage.getStoredScript(newId).trim()) return;
			          activeSlots.push(newId);
			          U.showToast(`Slot #${newId} enabled`);
			        }
			        Storage.setActiveStickySlots(activeSlots, `hotkey [${newId}] toggle`);
			        syncStickyUi();
			        Preview.syncPreview();
			      } else {
			        const prevId = Storage.getCurrentScriptId();
			        Log.key(e, `Switched slot #${prevId} ➔ #${newId}`, { prevId, newId });
			
			        Storage.setCurrentScriptId(newId, `hotkey [${newId}]`);
			        const scriptVal = Storage.getStoredScript(newId);
			        setFieldDisplayValue(scriptVal, `hotkey [${newId}]`);
			        Preview.syncPreview();
			
			        U.showToast(`Switched to tag script #${newId}. Use 1-9 keys to switch.`);
			      }
			    }, true);
			  }
			
			  function init() {
			    [injectUI, setupThumbnailClickListener, setupHotkeys, Preview.init, Runner.syncQueuedOutlines].forEach(feature => {
			      try {
			        Promise.resolve(feature()).catch(err => U.logWarn(`tagScript.${feature.name}`, err));
			      } catch (err) {
			        U.logWarn(`tagScript.${feature.name}`, err);
			      }
			    });
			
			    chrome.storage.onChanged.addListener((changes, area) => {
			      if (area === 'local' && (changes[E621_CONSTANTS.STORAGE_KEYS.TAG_SCRIPT_QUEUE] || changes[E621_CONSTANTS.STORAGE_KEYS.QUEUE_TAG_SCRIPTS_ENABLED])) {
			        Runner.syncQueuedOutlines();
			      }
			    });
			  }
			
			  return { init, syncQueuedOutlines: Runner.syncQueuedOutlines };
			});
			// END: scripts/tag_script/index.js
			
			// START: scripts/content.js
			(function () {
			  'use strict';
			  const { ACTIONS } = E621_CONSTANTS;
			  const U = E621X.get('utils');
			  const blacklist = E621X.get('blacklist');
			  const tree = E621X.get('tree');
			  const queue = E621X.get('tagScriptQueue');
			
			  const handlers = {
			    [ACTIONS.SHOW_POST_TREE]: async (req) => {
			      if (!req.postId) return U.fail('Invalid post ID');
			      tree.open(req.postId);
			      return U.ok('Opening post tree...');
			    },
			    [ACTIONS.BACKUP_BLACKLIST]: () => blacklist.backupBlacklist(),
			    [ACTIONS.LOAD_DOWNVOTES]: () => blacklist.loadDownvotes(),
			    [ACTIONS.UPLOAD_DOWNVOTES]: () => blacklist.uploadDownvotes(),
			    [ACTIONS.UNLOAD_DOWNVOTES]: () => blacklist.unloadDownvotes(),
			    [ACTIONS.SYNC_API]: () => blacklist.syncApi(),
			    [ACTIONS.TOGGLE_AUTO_UPDATE]: () => blacklist.toggleAutoUpdate(),
			    [ACTIONS.PROCESS_TAG_QUEUE]: async () => {
			      const res = await queue.processQueue();
			      return U.ok(`Queue processed: ${res.updated || 0} updated`);
			    },
			    [ACTIONS.TAG_SCRIPT_POST_STATUS]: (req) => {
			      const runner = E621X.get('tagScriptRunner');
			      if (runner?.onPostStatus) {
			        runner.onPostStatus(req.postId, req.status, req.error);
			      }
			      return U.ok();
			    }
			  };
			
			  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
			    if (chrome.runtime?.id && sender?.id && sender.id !== chrome.runtime.id) return false;
			
			    const handler = handlers[request?.action];
			    if (!handler) {
			      sendResponse({ ok: false, status: 'Unknown action' });
			      return false;
			    }
			
			    Promise.resolve()
			      .then(() => handler(request))
			      .catch(err => {
			        U.logWarn(`action ${request.action}`, err);
			        return U.fail(err.message || String(err));
			      })
			      .then(result => sendResponse({ ok: result.ok, status: result.message }));
			    return true;
			  });
			
			  window.addEventListener('message', async (event) => {
			    if (!event.data || !event.data.fromE621Popup) return;
			    const { action } = event.data;
			    const handler = handlers[action];
			    const port = event.ports && event.ports[0];
			
			    if (!handler) {
			      if (port) port.postMessage({ ok: false, status: 'Unknown action' });
			      return;
			    }
			
			    try {
			      const result = await Promise.resolve(handler(event.data));
			      if (port) port.postMessage({ ok: result.ok, status: result.message });
			    } catch (err) {
			      U.logWarn(`postMessage action ${action}`, err);
			      if (port) port.postMessage({ ok: false, status: err.message || String(err) });
			    }
			  });
			
			  (async function start() {
			    await U.ensureStorageSchema();
			    const csrf = U.getCsrfToken();
			    if (csrf && chrome.runtime?.id) {
			      chrome.runtime.sendMessage({ action: ACTIONS.SET_CSRF_TOKEN, csrfToken: csrf }).catch(() => {});
			    }
			    for (const name of ['uploader', 'userEdits', 'tree', 'blacklist', 'hoverZoom', 'tagScriptQueue', 'timeoutedPage', 'tagScript', 'tooltipsManager']) {
			      try {
			        await E621X.get(name).init();
			      } catch (err) {
			        U.logWarn(`init ${name}`, err);
			      }
			    }
			  })();
			})();
			// END: scripts/content.js
			;}
			   } catch(e) { _error(`  Error executing scripts ${scriptPaths}`, e); }
			  
			  } else {
			      _log(`Skipping document-end phase (no document).`);
			  }
			
			  
  // #endregion
  // #region Wait for Document Idle
			  _log(`Waiting for document idle state...`);
			  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
			      await new Promise(resolve => window.requestIdleCallback(resolve, { timeout: 2000 })); // 2-second timeout fallback
			      _log(`requestIdleCallback fired or timed out.`);
			  } else {
			      // Fallback: wait a short period after DOMContentLoaded/current execution if requestIdleCallback is unavailable
			      await new Promise(resolve => setTimeout(resolve, 50));
			      _log(`Idle fallback timer completed.`);
			  }
			  
			
  // #endregion
  // #region Document Idle
			   if (typeof document !== 'undefined') {
			    _log(`Executing document-idle phase...`);
			    
			    const scriptPaths = [];
			   _log(`  Executing JS (idle): ${scriptPaths}`);
			
			   try {
			       // Keep variables from being redeclared for global scope, but also make them apply to global scope. (Theoretically)
			      with (globalThis){;
			
			;}
			   } catch(e) { _error(`  Error executing scripts ${scriptPaths}`, e); }
			  
			  } else {
			      _log(`Skipping document-idle phase (no document).`);
			  }
			
			  _log(`All execution phases complete, re-firing load events.`);
			  document.dispatchEvent(new Event("DOMContentLoaded", {
			    bubbles: true,
			    cancelable: true
			  }));
			}
			
  // #endregion
// #region Event Listener No changes needed here ---
			window.addEventListener("message", (event) => {
			  if (event.data.type === "openOptionsPage") {
			    openOptionsPage();
			  }
			  if (event.data.type === "openPopupPage") {
			    openPopupPage();
			  }
			  if (event.data.type === "closeOptionsPage") {
			    closeOptionsModal();
			  }
			  if (event.data.type === "closePopupPage") {
			    closePopupModal();
			  }
			});
			
// #endregion
// #region Refactored Modal Closing Functions Promise-based ---
			
			function closeOptionsModal() {
			  return new Promise((resolve) => {
			    const DURATION = 100;
			    const backdrop = document.getElementById("extension-options-backdrop");
			    const modal = document.getElementById("extension-options-modal");
			
			    if (!backdrop || !modal) {
			      return resolve();
			    }
			
			    modal.style.animation = `modalCloseAnimation ${DURATION / 1000}s ease-out forwards`;
			    backdrop.style.animation = `backdropFadeOut ${DURATION / 1000}s ease-out forwards`;
			
			    setTimeout(() => {
			      if (confirm("Close options and reload the page?")) {
			        window.location.reload(); // Note: This will stop further execution
			      } else {
			        backdrop.remove();
			      }
			      resolve();
			    }, DURATION);
			  });
			}
			
			function closePopupModal() {
			  return new Promise((resolve) => {
			    const DURATION = 100;
			    const backdrop = document.getElementById("extension-popup-backdrop");
			    const modal = document.getElementById("extension-popup-modal");
			
			    if (!backdrop || !modal) {
			      return resolve();
			    }
			
			    modal.style.animation = `modalCloseAnimation ${DURATION / 1000}s ease-out forwards`;
			    backdrop.style.animation = `backdropFadeOut ${DURATION / 1000}s ease-out forwards`;
			
			    setTimeout(() => {
			      backdrop.remove();
			      resolve();
			    }, DURATION);
			  });
			}
			
// #endregion
// #region Simplified Public API Functions ---
			
			async function openPopupPage() {
			  if (!POPUP_PAGE_PATH || typeof EXTENSION_ASSETS_MAP === "undefined") {
			    _warn("No popup page available.");
			    return;
			  }
			  await openModal({
			    type: "popup",
			    pagePath: POPUP_PAGE_PATH,
			    defaultTitle: "Extension Popup",
			    closeFn: closePopupModal,
			  });
			}
			
			async function openOptionsPage() {
			  if (!OPTIONS_PAGE_PATH || typeof EXTENSION_ASSETS_MAP === "undefined") {
			    _warn("No options page available.");
			    return;
			  }
			  await openModal({
			    type: "options",
			    pagePath: OPTIONS_PAGE_PATH,
			    defaultTitle: "Extension Options",
			    closeFn: closeOptionsModal,
			  });
			}
			
// #endregion
// #region Generic Modal Logic Style Injection ---
			
			let stylesInjected = false;
			function injectGlobalStyles() {
			  if (stylesInjected) return;
			  stylesInjected = true;
			
			  const styles = `
			        .extension-backdrop {
			            position: fixed;
			            top: 0; left: 0;
			            width: 100vw; height: 100vh;
			            background: rgba(0, 0, 0, 0.13);
			            backdrop-filter: blur(3px);
			            z-index: 2147483646;
			            display: flex;
			            align-items: center;
			            justify-content: center;
			            animation: backdropFadeIn 0.3s ease-out forwards;
			        }
			
			        .extension-modal {
			            z-index: 2147483647;
			            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
			            --background: #ffffff;
			            --rad: 10px;
			            --border: #666;
			            --border-thickness: 2px;
			            display: flex;
			            flex-direction: column;
			            overflow: hidden;
			            animation: modalOpenAnimation 0.3s ease-out forwards;
			        }
			
			        /* Size specific styles */
			        .extension-modal.popup-size {
			            width: 400px; height: 600px;
			            max-width: calc(100vw - 40px);
			            max-height: calc(100vh - 40px);
			        }
			        .extension-modal.options-size {
			            width: calc(100vw - 80px); height: calc(100vh - 80px);
			            max-width: 1200px;
			            max-height: 800px;
			        }
			
			        /* Common modal components */
			        .extension-modal .modal-header {
			            display: flex; justify-content: space-between; align-items: flex-end;
			            padding: 0 16px; position: relative; flex-shrink: 0;
			        }
			        .extension-modal .tab {
			            padding: 12px 16px; color: #606266;
			            display: flex; align-items: center; gap: 8px;
			            font-size: 14px; cursor: pointer;
			            border-radius: var(--rad) var(--rad) 0 0;
			            transition: background-color 0.2s ease; user-select: none;
			        }
			        .extension-modal .tab.active, .extension-modal .tab.close-button {
			            background-color: var(--background);
			            border: var(--border-thickness) solid var(--border);
			            border-bottom-color: var(--background);
			            margin-bottom: -1px; z-index: 1;
			            color: #303133; font-weight: 500;
			        }
			        .extension-modal .tab.close-button { padding: 8px; }
			        .extension-modal .tab.close-button:hover { background-color: #f5f7fa; }
			        .extension-modal .tab svg { stroke: currentColor; }
			        .extension-modal .tab.active img { width: 16px; height: 16px; }
			        .extension-modal .tab.close-button svg { width: 20px; height: 20px; }
			
			        .extension-modal .modal-content {
			            flex-grow: 1; position: relative;
			            border-radius: var(--rad); overflow: hidden;
			            bottom: calc(var(--border-thickness) - 1px);
			            border: var(--border-thickness) solid var(--border);
			        }
			        .extension-modal .modal-content iframe {
			            width: 100%; height: 100%; border: 0; background: white;
			        }
			
			        /* Animations */
			        @keyframes backdropFadeIn { from { opacity: 0; backdrop-filter: blur(0px); } to { opacity: 1; backdrop-filter: blur(3px); } }
			        @keyframes backdropFadeOut { from { opacity: 1; backdrop-filter: blur(3px); } to { opacity: 0; backdrop-filter: blur(0px); } }
			        @keyframes modalOpenAnimation { from { transform: scaleY(0.8); opacity: 0; } to { transform: scaleY(1); opacity: 1; } }
			        @keyframes modalCloseAnimation { from { transform: scaleY(1); opacity: 1; } to { transform: scaleY(0.8); opacity: 0; } }
			    `;
			  const styleSheet = document.createElement("style");
			  styleSheet.id = "extension-global-styles";
			  styleSheet.innerText = styles;
			  document.head.appendChild(styleSheet);
			}
			
			async function openModal(config) {
			  injectGlobalStyles();
			
			  const { type, pagePath, defaultTitle, closeFn } = config;
			  const html = EXTENSION_ASSETS_MAP[pagePath];
			  if (!html) {
			    _warn(`${defaultTitle} HTML not found in asset map`);
			    return;
			  }
			
			  const backdropId = `extension-${type}-backdrop`;
			  const modalId = `extension-${type}-modal`;
			  const sizeClass = `${type}-size`;
			
// #endregion
  // #region Smoothly close the other modal if it s open ---
			  const otherType = type === "popup" ? "options" : "popup";
			  const otherBackdrop = document.getElementById(
			    `extension-${otherType}-backdrop`
			  );
			  if (otherBackdrop) {
			    // Await the correct close function
			    await (otherType === "popup" ? closePopupModal() : closeOptionsModal());
			  }
			
			  let backdrop = document.getElementById(backdropId);
			  let modal, iframe;
			
			  if (!backdrop) {
			    backdrop = document.createElement("div");
			    backdrop.id = backdropId;
			    backdrop.className = "extension-backdrop";
			
			    modal = document.createElement("div");
			    modal.id = modalId;
			    modal.className = `extension-modal ${sizeClass}`;
			
			    const extensionName = INJECTED_MANIFEST.name || defaultTitle;
			    const iconSrc =
			      EXTENSION_ICON ||
			      "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBzdHJva2Utd2lkdGg9IjIiIGZpbGw9Im5vbmUiIHN0cm9rZT0iY3VycmVudENvbG9yIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIHN0cm9rZT0ibm9uZSIgZD0iTTAgMGgyNHYyNEgweiIgZmlsbD0ibm9uZSIvPjxwYXRoIGQ9Ik00IDdoM2ExIDEgMCAwIDAgMSAtMXYtMWEyIDIgMCAwIDEgNCAwdjFhMSAxIDAgMCAwIDEgMWgzYTEgMSAwIDAgMSAxIDF2M2ExIDEgMCAwIDAgMSAxaDFhMiAyIDAgMCAxIDAgNGgtMWExIDEgMCAwIDAgLTEgMXYzYTEgMSAwIDAgMSAtMSAxaC0zYTEgMSAwIDAgMSAtMSAtMXYtMWEyIDIgMCAwIDAgLTQgMHYxYTEgMSAwIDAgMSAtMSAxaC0zYTEgMSAwIDAgMSAtMSAtMXYtM2ExIDEgMCAwIDEgMSAtMWgxYTIgMiAwIDAgMCAwIC00aC0xYTEgMSAwIDAgMSAtMSAtMXYtM2ExIDEgMCAwIDEgMSAtMSIgLz48L3N2Zz4=";
			
			    modal.innerHTML = `
			            <div class="modal-header">
			                <div class="tab active">
			                    <img src="${iconSrc}" onerror="this.style.display='none'">
			                    <span>${extensionName}</span>
			                </div>
			                <div class="tab close-button">
			                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
			                       <line x1="18" y1="6" x2="6" y2="18"></line>
			                       <line x1="6" y1="6" x2="18" y2="18"></line>
			                    </svg>
			                </div>
			            </div>
			            <div class="modal-content">
			                <iframe></iframe>
			            </div>
			        `;
			
			    backdrop.appendChild(modal);
			
			    backdrop.addEventListener("click", (e) => {
			      if (e.target === backdrop) closeFn();
			    });
			    modal.querySelector(".close-button").addEventListener("click", closeFn);
			
			    document.body.appendChild(backdrop);
			    iframe = modal.querySelector("iframe");
			  } else {
			    // If it already exists, just make sure it's visible
			    backdrop.style.display = "flex";
			    modal = backdrop.querySelector(".extension-modal");
			    iframe = modal.querySelector("iframe");
			  }
			
			  // Load content into iframe
			  try {
			    const polyfillString = generateCompletePolyfillForIframe();
			    const doc = new DOMParser().parseFromString(html, "text/html");
			    const cspNonce = Array.from(document.scripts).map(s => s.nonce).find(Boolean)
        || document.querySelector('meta[name="csp-nonce"]')?.content
        || document.querySelector('[nonce]')?.nonce
        || '';

      const script = doc.createElement("script");
      script.textContent = polyfillString;
      doc.head.insertAdjacentElement("afterbegin", script);

      if (cspNonce) {
        doc.querySelectorAll('script').forEach(s => s.setAttribute('nonce', cspNonce));
      }

      iframe.srcdoc = doc.documentElement.outerHTML;
			  } catch (e) {
			    _error("Error generating complete polyfill for iframe", e);
			    iframe.srcdoc = html;
			  }
			}
			
			function generateCompletePolyfillForIframe() {
			  const polyfillString = "\n// -- Messaging implementation\n\nfunction createEventBus(\n  scopeId,\n  type = \"page\", // \"page\" or \"iframe\"\n  { allowedOrigin = \"*\", children = [], parentWindow = null } = {}\n) {\n  if (!scopeId) throw new Error(\"createEventBus requires a scopeId\");\n\n  const handlers = {};\n\n  function handleIncoming(ev) {\n    if (allowedOrigin !== \"*\" && ev.origin !== allowedOrigin) return;\n\n    const msg = ev.data;\n    if (!msg || msg.__eventBus !== true || msg.scopeId !== scopeId) return;\n\n    const { event, payload } = msg;\n\n    // PAGE: if it's an INIT from an iframe, adopt it\n    if (type === \"page\" && event === \"__INIT__\") {\n      const win = ev.source;\n      if (win && !children.includes(win)) {\n        children.push(win);\n      }\n      return;\n    }\n\n    (handlers[event] || []).forEach((fn) =>\n      fn(payload, { origin: ev.origin, source: ev.source })\n    );\n  }\n\n  window.addEventListener(\"message\", handleIncoming);\n\n  function emitTo(win, event, payload) {\n    const envelope = {\n      __eventBus: true,\n      scopeId,\n      event,\n      payload,\n    };\n    win.postMessage(envelope, allowedOrigin);\n  }\n\n  // IFRAME: announce to page on startup\n  if (type === \"iframe\") {\n    setTimeout(() => {\n      const pw = parentWindow || window.parent;\n      if (pw && pw.postMessage) {\n        emitTo(pw, \"__INIT__\", null);\n      }\n    }, 0);\n  }\n\n  return {\n    on(event, fn) {\n      handlers[event] = handlers[event] || [];\n      handlers[event].push(fn);\n    },\n    off(event, fn) {\n      if (!handlers[event]) return;\n      handlers[event] = handlers[event].filter((h) => h !== fn);\n    },\n    /**\n     * Emits an event.\n     * @param {string} event - The event name.\n     * @param {any} payload - The event payload.\n     * @param {object} [options] - Emission options.\n     * @param {Window} [options.to] - A specific window to target. If provided, message is ONLY sent to the target.\n     */\n    emit(event, payload, { to } = {}) {\n      // If a specific target window is provided, send only to it and DO NOT dispatch locally.\n      // This prevents a port from receiving its own messages.\n      if (to) {\n        if (to && typeof to.postMessage === \"function\") {\n          emitTo(to, event, payload);\n        }\n        return; // Exit after targeted send.\n      }\n\n      // For broadcast messages (no 'to' target), dispatch locally first.\n      (handlers[event] || []).forEach((fn) =>\n        fn(payload, { origin: location.origin, source: window })\n      );\n\n      // Then propagate the broadcast to other windows.\n      if (type === \"page\") {\n        children.forEach((win) => emitTo(win, event, payload));\n      } else {\n        const pw = parentWindow || window.parent;\n        if (pw && pw.postMessage) {\n          emitTo(pw, event, payload);\n        }\n      }\n    },\n  };\n}\n\nfunction createRuntime(type = \"background\", bus) {\n  let nextId = 1;\n  const pending = {};\n  const msgListeners = [];\n\n  let nextPortId = 1;\n  const ports = {};\n  const onConnectListeners = [];\n\n  function parseArgs(args) {\n    let target, message, options, callback;\n    const arr = [...args];\n    if (arr.length === 0) {\n      throw new Error(\"sendMessage requires at least one argument\");\n    }\n    if (arr.length === 1) {\n      return { message: arr[0] };\n    }\n    // last object could be options\n    if (\n      arr.length &&\n      typeof arr[arr.length - 1] === \"object\" &&\n      !Array.isArray(arr[arr.length - 1])\n    ) {\n      options = arr.pop();\n    }\n    // last function is callback\n    if (arr.length && typeof arr[arr.length - 1] === \"function\") {\n      callback = arr.pop();\n    }\n    if (\n      arr.length === 2 &&\n      (typeof arr[0] === \"string\" || typeof arr[0] === \"number\")\n    ) {\n      [target, message] = arr;\n    } else {\n      [message] = arr;\n    }\n    return { target, message, options, callback };\n  }\n\n  if (type === \"background\") {\n    bus.on(\"__REQUEST__\", ({ id, message }, { source }) => {\n      let responded = false,\n        isAsync = false;\n      function sendResponse(resp) {\n        if (responded) return;\n        responded = true;\n        // Target the response directly back to the window that sent the request.\n        bus.emit(\"__RESPONSE__\", { id, response: resp }, { to: source });\n      }\n      const results = msgListeners\n        .map((fn) => {\n          try {\n            // msg, sender, sendResponse\n            const ret = fn(message, { id, tab: { id: source } }, sendResponse);\n            if (ret === true || (ret && typeof ret.then === \"function\")) {\n              isAsync = true;\n              return ret;\n            }\n            return ret;\n          } catch (e) {\n            _error(e);\n          }\n        })\n        .filter((r) => r !== undefined);\n\n      const promises = results.filter((r) => r && typeof r.then === \"function\");\n      if (!isAsync && promises.length === 0) {\n        const out = results.length === 1 ? results[0] : results;\n        sendResponse(out);\n      } else if (promises.length) {\n        Promise.all(promises).then((vals) => {\n          if (!responded) {\n            const out = vals.length === 1 ? vals[0] : vals;\n            sendResponse(out);\n          }\n        });\n      }\n    });\n  }\n\n  if (type !== \"background\") {\n    bus.on(\"__RESPONSE__\", ({ id, response }) => {\n      const entry = pending[id];\n      if (!entry) return;\n      entry.resolve(response);\n      if (entry.callback) entry.callback(response);\n      delete pending[id];\n    });\n  }\n\n  function sendMessage(...args) {\n    // Background should be able to send message to itself\n    // if (type === \"background\") {\n    //   throw new Error(\"Background cannot sendMessage to itself\");\n    // }\n    const { target, message, callback } = parseArgs(args);\n    const id = nextId++;\n    const promise = new Promise((resolve) => {\n      pending[id] = { resolve, callback };\n      bus.emit(\"__REQUEST__\", { id, message });\n    });\n    return promise;\n  }\n\n  bus.on(\"__PORT_CONNECT__\", ({ portId, name }, { source }) => {\n    if (type !== \"background\") return;\n    const backgroundPort = makePort(\"background\", portId, name, source);\n    ports[portId] = backgroundPort;\n\n    onConnectListeners.forEach((fn) => fn(backgroundPort));\n\n    // send back a CONNECT_ACK so the client can\n    // start listening on its end:\n    bus.emit(\"__PORT_CONNECT_ACK__\", { portId, name }, { to: source });\n  });\n\n  // Clients handle the ACK and finalize their Port object by learning the remote window.\n  bus.on(\"__PORT_CONNECT_ACK__\", ({ portId, name }, { source }) => {\n    if (type === \"background\") return; // ignore\n    const p = ports[portId];\n    if (!p) return;\n    // Call the port's internal finalize method to complete the handshake\n    if (p._finalize) {\n      p._finalize(source);\n    }\n  });\n\n  // Any port message travels via \"__PORT_MESSAGE__\"\n  bus.on(\"__PORT_MESSAGE__\", (envelope, { source }) => {\n    const { portId } = envelope;\n    const p = ports[portId];\n    if (!p) return;\n    p._receive(envelope, source);\n  });\n\n  // Any port disconnect:\n  bus.on(\"__PORT_DISCONNECT__\", ({ portId }) => {\n    const p = ports[portId];\n    if (!p) return;\n    p._disconnect();\n    delete ports[portId];\n  });\n\n  // Refactored makePort to correctly manage internal state and the connection handshake.\n  function makePort(side, portId, name, remoteWindow) {\n    let onMessageHandlers = [];\n    let onDisconnectHandlers = [];\n    let buffer = [];\n    // Unique instance ID for this port instance\n    const instanceId = Math.random().toString(36).slice(2) + Date.now();\n    // These state variables are part of the closure and are updated by _finalize\n    let _ready = side === \"background\";\n\n    function _drainBuffer() {\n      buffer.forEach((m) => _post(m));\n      buffer = [];\n    }\n\n    function _post(msg) {\n      // Always use the 'to' parameter for port messages, making them directional.\n      // Include senderInstanceId\n      bus.emit(\n        \"__PORT_MESSAGE__\",\n        { portId, msg, senderInstanceId: instanceId },\n        { to: remoteWindow }\n      );\n    }\n\n    function postMessage(msg) {\n      if (!_ready) {\n        buffer.push(msg);\n      } else {\n        _post(msg);\n      }\n    }\n\n    function _receive(envelope, source) {\n      // envelope: { msg, senderInstanceId }\n      if (envelope.senderInstanceId === instanceId) return; // Don't dispatch to self\n      onMessageHandlers.forEach((fn) =>\n        fn(envelope.msg, { id: portId, tab: { id: source } })\n      );\n    }\n\n    function disconnect() {\n      // Also use the 'to' parameter for disconnect messages\n      bus.emit(\"__PORT_DISCONNECT__\", { portId }, { to: remoteWindow });\n      _disconnect();\n      delete ports[portId];\n    }\n\n    function _disconnect() {\n      onDisconnectHandlers.forEach((fn) => fn());\n      onMessageHandlers = [];\n      onDisconnectHandlers = [];\n    }\n\n    // This function is called on the client port when the ACK is received from background.\n    // It updates the port's state, completing the connection.\n    function _finalize(win) {\n      remoteWindow = win; // <-- This is the crucial part: learn the destination\n      _ready = true;\n      _drainBuffer();\n    }\n\n    return {\n      name,\n      sender: {\n        id: portId,\n      },\n      onMessage: {\n        addListener(fn) {\n          onMessageHandlers.push(fn);\n        },\n        removeListener(fn) {\n          onMessageHandlers = onMessageHandlers.filter((x) => x !== fn);\n        },\n      },\n      onDisconnect: {\n        addListener(fn) {\n          onDisconnectHandlers.push(fn);\n        },\n        removeListener(fn) {\n          onDisconnectHandlers = onDisconnectHandlers.filter((x) => x !== fn);\n        },\n      },\n      postMessage,\n      disconnect,\n      // Internal methods used by the runtime\n      _receive,\n      _disconnect,\n      _finalize, // Expose the finalizer for the ACK handler\n    };\n  }\n\n  function connect(connectInfo = {}) {\n    if (type === \"background\") {\n      throw new Error(\"Background must use onConnect, not connect()\");\n    }\n    const name = connectInfo.name || \"\";\n    const portId = nextPortId++;\n    // create the client side port\n    // remoteWindow is initially null; it will be set by _finalize upon ACK.\n    const clientPort = makePort(\"client\", portId, name, null);\n    ports[portId] = clientPort;\n\n    // fire the connect event across the bus\n    bus.emit(\"__PORT_CONNECT__\", { portId, name });\n    return clientPort;\n  }\n\n  function onConnect(fn) {\n    if (type !== \"background\") {\n      throw new Error(\"connect event only fires in background\");\n    }\n    onConnectListeners.push(fn);\n  }\n\n  return {\n    // rpc:\n    sendMessage,\n    onMessage: {\n      addListener(fn) {\n        msgListeners.push(fn);\n      },\n      removeListener(fn) {\n        const i = msgListeners.indexOf(fn);\n        if (i >= 0) msgListeners.splice(i, 1);\n      },\n    },\n\n    // port API:\n    connect,\n    onConnect: {\n      addListener(fn) {\n        onConnect(fn);\n      },\n      removeListener(fn) {\n        const i = onConnectListeners.indexOf(fn);\n        if (i >= 0) onConnectListeners.splice(i, 1);\n      },\n    },\n  };\n}\n\n\n// --- Abstraction Layer: PostMessage Target\n\nlet nextRequestId = 1;\nconst pendingRequests = new Map(); // requestId -> { resolve, reject, timeout }\n\nfunction sendAbstractionRequest(method, args = []) {\n  return new Promise((resolve, reject) => {\n    const requestId = nextRequestId++;\n\n    const timeout = setTimeout(() => {\n      pendingRequests.delete(requestId);\n      reject(new Error(`PostMessage request timeout for method: ${method}`));\n    }, 10000);\n\n    pendingRequests.set(requestId, { resolve, reject, timeout });\n\n    window.parent.postMessage({\n      type: \"abstraction-request\",\n      requestId,\n      method,\n      args,\n    });\n  });\n}\n\nwindow.addEventListener(\"message\", (event) => {\n  const { type, requestId, success, result, error } = event.data;\n\n  if (type === \"abstraction-response\") {\n    const pending = pendingRequests.get(requestId);\n    if (pending) {\n      clearTimeout(pending.timeout);\n      pendingRequests.delete(requestId);\n\n      if (success) {\n        pending.resolve(result);\n      } else {\n        const err = new Error(error.message);\n        err.stack = error.stack;\n        pending.reject(err);\n      }\n    }\n  }\n});\n\nasync function _storageSet(items) {\n  return sendAbstractionRequest(\"_storageSet\", [items]);\n}\n\nasync function _storageGet(keys) {\n  return sendAbstractionRequest(\"_storageGet\", [keys]);\n}\n\nasync function _storageRemove(keysToRemove) {\n  return sendAbstractionRequest(\"_storageRemove\", [keysToRemove]);\n}\n\nasync function _storageClear() {\n  return sendAbstractionRequest(\"_storageClear\");\n}\n\nasync function _cookieList(details) {\n  return sendAbstractionRequest(\"_cookieList\", [details]);\n}\n\nasync function _cookieSet(details) {\n  return sendAbstractionRequest(\"_cookieSet\", [details]);\n}\n\nasync function _cookieDelete(details) {\n  return sendAbstractionRequest(\"_cookieDelete\", [details]);\n}\n\nasync function _fetch(url, options) {\n  return sendAbstractionRequest(\"_fetch\", [url, options]);\n}\n\nfunction _registerMenuCommand(name, func) {\n  _warn(\"_registerMenuCommand called from iframe context:\", name);\n  return sendAbstractionRequest(\"_registerMenuCommand\", [\n    name,\n    func.toString(),\n  ]);\n}\n\nfunction _openTab(url, active) {\n  return sendAbstractionRequest(\"_openTab\", [url, active]);\n}\n\nasync function _initStorage() {\n  return sendAbstractionRequest(\"_initStorage\");\n}\n\n\nconst EXTENSION_ASSETS_MAP = {{EXTENSION_ASSETS_MAP}};\n\n// -- Polyfill Implementation\nfunction buildPolyfill({ isBackground = false, isOtherPage = false } = {}) {\n  // Generate a unique context ID for this polyfill instance\n  const contextType = isBackground\n    ? \"background\"\n    : isOtherPage\n      ? \"options\"\n      : \"content\";\n  const contextId = `${contextType}_${Math.random()\n    .toString(36)\n    .substring(2, 15)}`;\n\n  const IS_IFRAME = \"true\" === \"true\";\n  const BUS = (function () {\n    if (globalThis.__BUS) {\n      return globalThis.__BUS;\n    }\n    globalThis.__BUS = createEventBus(\n      \"e621-extras\",\n      IS_IFRAME ? \"iframe\" : \"page\",\n    );\n    return globalThis.__BUS;\n  })();\n  const RUNTIME = createRuntime(isBackground ? \"background\" : \"tab\", BUS);\n  const createNoopListeners = () => ({\n    addListener: (callback) => {\n      _log(\"addListener\", callback);\n    },\n    removeListener: (callback) => {\n      _log(\"removeListener\", callback);\n    },\n  });\n  // TODO: Stub\n  const storageChangeListeners = new Set();\n  function broadcastStorageChange(changes, areaName) {\n    storageChangeListeners.forEach((listener) => {\n      listener(changes, areaName);\n    });\n  }\n\n  let REQ_PERMS = [];\n\n  // --- Chrome polyfill\n  let chrome = {\n    extension: {\n      isAllowedIncognitoAccess: () => Promise.resolve(true),\n      sendMessage: (...args) => _messagingHandler.sendMessage(...args),\n    },\n    permissions: {\n      // TODO: Remove origin permission means exclude from origin in startup (when checking for content scripts)\n      request: (permissions, callback) => {\n        _log(\"permissions.request\", permissions, callback);\n        if (Array.isArray(permissions)) {\n          REQ_PERMS = [...REQ_PERMS, ...permissions];\n        }\n        if (typeof callback === \"function\") {\n          callback(permissions);\n        }\n        return Promise.resolve(permissions);\n      },\n      contains: (permissions, callback) => {\n        if (typeof callback === \"function\") {\n          callback(true);\n        }\n        return Promise.resolve(true);\n      },\n      getAll: () => {\n        return Promise.resolve({\n          permissions: EXTENSION_PERMISSIONS,\n          origins: ORIGIN_PERMISSIONS,\n        });\n      },\n      onAdded: createNoopListeners(),\n      onRemoved: createNoopListeners(),\n    },\n    i18n: {\n      getUILanguage: () => {\n        return USED_LOCALE || \"en\";\n      },\n      getMessage: (key, substitutions = []) => {\n        if (typeof substitutions === \"string\") {\n          substitutions = [substitutions];\n        }\n        if (typeof LOCALE_KEYS !== \"undefined\" && LOCALE_KEYS[key]) {\n          return LOCALE_KEYS[key].message?.replace(\n            /\\$(\\d+)/g,\n            (match, p1) => substitutions[p1 - 1] || match,\n          );\n        }\n        return key;\n      },\n    },\n    alarms: {\n      onAlarm: createNoopListeners(),\n      create: () => {\n        _log(\"alarms.create\", arguments);\n      },\n      get: () => {\n        _log(\"alarms.get\", arguments);\n      },\n    },\n    runtime: {\n      ...RUNTIME,\n      onInstalled: createNoopListeners(),\n      onStartup: createNoopListeners(),\n      // TODO: Postmessage to parent to open options page or call openOptionsPage\n      openOptionsPage: () => {\n        // const url = chrome.runtime.getURL(OPTIONS_PAGE_PATH);\n        // console.log(\"openOptionsPage\", _openTab, url, EXTENSION_ASSETS_MAP);\n        // _openTab(url);\n        if (typeof openOptionsPage === \"function\") {\n          openOptionsPage();\n        } else if (window.parent) {\n          window.parent.postMessage({ type: \"openOptionsPage\" }, \"*\");\n        } else {\n          _warn(\"openOptionsPage not available.\");\n        }\n      },\n      getManifest: () => {\n        // The manifest object will be injected into the scope where buildPolyfill is called\n        if (typeof INJECTED_MANIFEST !== \"undefined\") {\n          return JSON.parse(JSON.stringify(INJECTED_MANIFEST)); // Return deep copy\n        }\n        _warn(\"INJECTED_MANIFEST not found for chrome.runtime.getManifest\");\n        return { name: \"Unknown\", version: \"0.0\", manifest_version: 2 };\n      },\n      getURL: (path) => {\n        if (!path) return \"\";\n        if (path.startsWith(\"/\")) {\n          path = path.substring(1);\n        }\n\n        if (typeof _createAssetUrl === \"function\") {\n          return _createAssetUrl(path);\n        }\n\n        _warn(\n          `chrome.runtime.getURL fallback for '${path}'. Assets may not be available.`,\n        );\n        // Attempt a relative path resolution (highly context-dependent and likely wrong)\n        try {\n          if (window.location.protocol.startsWith(\"http\")) {\n            return new URL(path, window.location.href).toString();\n          }\n        } catch (e) {\n          /* ignore error, fallback */\n        }\n        return path;\n      },\n      id: \"polyfilled-extension-\" + Math.random().toString(36).substring(2, 15),\n      lastError: null,\n      setUninstallURL: () => {},\n      setUpdateURL: () => {},\n      getPlatformInfo: async () => {\n        const platform = {\n          os: \"unknown\",\n          arch: \"unknown\",\n          nacl_arch: \"unknown\",\n        };\n\n        if (typeof navigator !== \"undefined\") {\n          const userAgent = navigator.userAgent.toLowerCase();\n          if (userAgent.includes(\"mac\")) platform.os = \"mac\";\n          else if (userAgent.includes(\"win\")) platform.os = \"win\";\n          else if (userAgent.includes(\"linux\")) platform.os = \"linux\";\n          else if (userAgent.includes(\"android\")) platform.os = \"android\";\n          else if (userAgent.includes(\"ios\")) platform.os = \"ios\";\n\n          if (userAgent.includes(\"x86_64\") || userAgent.includes(\"amd64\")) {\n            platform.arch = \"x86-64\";\n          } else if (userAgent.includes(\"i386\") || userAgent.includes(\"i686\")) {\n            platform.arch = \"x86-32\";\n          } else if (userAgent.includes(\"arm\")) {\n            platform.arch = \"arm\";\n          }\n        }\n\n        return platform;\n      },\n      getBrowserInfo: async () => {\n        const info = {\n          name: \"unknown\",\n          version: \"unknown\",\n          buildID: \"unknown\",\n        };\n\n        if (typeof navigator !== \"undefined\") {\n          const userAgent = navigator.userAgent;\n          if (userAgent.includes(\"Chrome\")) {\n            info.name = \"Chrome\";\n            const match = userAgent.match(/Chrome\\/([0-9.]+)/);\n            if (match) info.version = match[1];\n          } else if (userAgent.includes(\"Firefox\")) {\n            info.name = \"Firefox\";\n            const match = userAgent.match(/Firefox\\/([0-9.]+)/);\n            if (match) info.version = match[1];\n          } else if (userAgent.includes(\"Safari\")) {\n            info.name = \"Safari\";\n            const match = userAgent.match(/Version\\/([0-9.]+)/);\n            if (match) info.version = match[1];\n          }\n        }\n\n        return info;\n      },\n    },\n    storage: {\n      local: {\n        get: function (keys, callback) {\n          if (typeof _storageGet !== \"function\")\n            throw new Error(\"_storageGet not defined\");\n\n          const promise = _storageGet(keys);\n\n          if (typeof callback === \"function\") {\n            promise\n              .then((result) => {\n                try {\n                  callback(result);\n                } catch (e) {\n                  _error(\"Error in storage.get callback:\", e);\n                }\n              })\n              .catch((error) => {\n                _error(\"Storage.get error:\", error);\n                callback({});\n              });\n            return;\n          }\n\n          return promise;\n        },\n        set: function (items, callback) {\n          if (typeof _storageSet !== \"function\")\n            throw new Error(\"_storageSet not defined\");\n\n          const promise = _storageSet(items).then((result) => {\n            broadcastStorageChange(items, \"local\");\n            return result;\n          });\n\n          if (typeof callback === \"function\") {\n            promise\n              .then((result) => {\n                try {\n                  callback(result);\n                } catch (e) {\n                  _error(\"Error in storage.set callback:\", e);\n                }\n              })\n              .catch((error) => {\n                _error(\"Storage.set error:\", error);\n                callback();\n              });\n            return;\n          }\n\n          return promise;\n        },\n        remove: function (keys, callback) {\n          if (typeof _storageRemove !== \"function\")\n            throw new Error(\"_storageRemove not defined\");\n\n          const promise = _storageRemove(keys).then((result) => {\n            const changes = {};\n            const keyList = Array.isArray(keys) ? keys : [keys];\n            keyList.forEach((key) => {\n              changes[key] = { oldValue: undefined, newValue: undefined };\n            });\n            broadcastStorageChange(changes, \"local\");\n            return result;\n          });\n\n          if (typeof callback === \"function\") {\n            promise\n              .then((result) => {\n                try {\n                  callback(result);\n                } catch (e) {\n                  _error(\"Error in storage.remove callback:\", e);\n                }\n              })\n              .catch((error) => {\n                _error(\"Storage.remove error:\", error);\n                callback();\n              });\n            return;\n          }\n\n          return promise;\n        },\n        clear: function (callback) {\n          if (typeof _storageClear !== \"function\")\n            throw new Error(\"_storageClear not defined\");\n\n          const promise = _storageClear().then((result) => {\n            broadcastStorageChange({}, \"local\");\n            return result;\n          });\n\n          if (typeof callback === \"function\") {\n            promise\n              .then((result) => {\n                try {\n                  callback(result);\n                } catch (e) {\n                  _error(\"Error in storage.clear callback:\", e);\n                }\n              })\n              .catch((error) => {\n                _error(\"Storage.clear error:\", error);\n                callback();\n              });\n            return;\n          }\n\n          return promise;\n        },\n        onChanged: {\n          addListener: (callback) => {\n            storageChangeListeners.add(callback);\n          },\n          removeListener: (callback) => {\n            storageChangeListeners.delete(callback);\n          },\n        },\n      },\n      sync: {\n        get: function (keys, callback) {\n          _warn(\"chrome.storage.sync polyfill maps to local\");\n          return chrome.storage.local.get(keys, callback);\n        },\n        set: function (items, callback) {\n          _warn(\"chrome.storage.sync polyfill maps to local\");\n\n          const promise = chrome.storage.local.set(items).then((result) => {\n            broadcastStorageChange(items, \"sync\");\n            return result;\n          });\n\n          if (typeof callback === \"function\") {\n            promise\n              .then((result) => {\n                try {\n                  callback(result);\n                } catch (e) {\n                  _error(\"Error in storage.sync.set callback:\", e);\n                }\n              })\n              .catch((error) => {\n                _error(\"Storage.sync.set error:\", error);\n                callback();\n              });\n            return;\n          }\n\n          return promise;\n        },\n        remove: function (keys, callback) {\n          _warn(\"chrome.storage.sync polyfill maps to local\");\n\n          const promise = chrome.storage.local.remove(keys).then((result) => {\n            const changes = {};\n            const keyList = Array.isArray(keys) ? keys : [keys];\n            keyList.forEach((key) => {\n              changes[key] = { oldValue: undefined, newValue: undefined };\n            });\n            broadcastStorageChange(changes, \"sync\");\n            return result;\n          });\n\n          if (typeof callback === \"function\") {\n            promise\n              .then((result) => {\n                try {\n                  callback(result);\n                } catch (e) {\n                  _error(\"Error in storage.sync.remove callback:\", e);\n                }\n              })\n              .catch((error) => {\n                _error(\"Storage.sync.remove error:\", error);\n                callback();\n              });\n            return;\n          }\n\n          return promise;\n        },\n        clear: function (callback) {\n          _warn(\"chrome.storage.sync polyfill maps to local\");\n\n          const promise = chrome.storage.local.clear().then((result) => {\n            broadcastStorageChange({}, \"sync\");\n            return result;\n          });\n\n          if (typeof callback === \"function\") {\n            promise\n              .then((result) => {\n                try {\n                  callback(result);\n                } catch (e) {\n                  _error(\"Error in storage.sync.clear callback:\", e);\n                }\n              })\n              .catch((error) => {\n                _error(\"Storage.sync.clear error:\", error);\n                callback();\n              });\n            return;\n          }\n\n          return promise;\n        },\n        onChanged: {\n          addListener: (callback) => {\n            storageChangeListeners.add(callback);\n          },\n          removeListener: (callback) => {\n            storageChangeListeners.delete(callback);\n          },\n        },\n      },\n      onChanged: {\n        addListener: (callback) => {\n          storageChangeListeners.add(callback);\n        },\n        removeListener: (callback) => {\n          storageChangeListeners.delete(callback);\n        },\n      },\n      managed: {\n        get: function (keys, callback) {\n          _warn(\"chrome.storage.managed polyfill is read-only empty.\");\n\n          const promise = Promise.resolve({});\n\n          if (typeof callback === \"function\") {\n            promise.then((result) => {\n              try {\n                callback(result);\n              } catch (e) {\n                _error(\"Error in storage.managed.get callback:\", e);\n              }\n            });\n            return;\n          }\n\n          return promise;\n        },\n      },\n    },\n    cookies: (function () {\n      const cookieChangeListeners = new Set();\n      function broadcastCookieChange(changeInfo) {\n        cookieChangeListeners.forEach((listener) => {\n          try {\n            listener(changeInfo);\n          } catch (e) {\n            _error(\"Error in cookies.onChanged listener:\", e);\n          }\n        });\n      }\n\n      function handlePromiseCallback(promise, callback) {\n        if (typeof callback === \"function\") {\n          promise\n            .then((result) => callback(result))\n            .catch((error) => {\n              // chrome.runtime.lastError = { message: error.message }; // TODO: Implement lastError\n              _error(error);\n              callback(); // Call with undefined on error\n            });\n          return;\n        }\n        return promise;\n      }\n\n      return {\n        get: function (details, callback) {\n          if (typeof _cookieList !== \"function\") {\n            return handlePromiseCallback(\n              Promise.reject(new Error(\"_cookieList not defined\")),\n              callback,\n            );\n          }\n          const promise = _cookieList({\n            url: details.url,\n            name: details.name,\n            storeId: details.storeId,\n            partitionKey: details.partitionKey,\n          }).then((cookies) => {\n            if (!cookies || cookies.length === 0) {\n              return null;\n            }\n            // Sort by path length (longest first), then creation time (earliest first, if available)\n            cookies.sort((a, b) => {\n              const pathLenDiff = (b.path || \"\").length - (a.path || \"\").length;\n              if (pathLenDiff !== 0) return pathLenDiff;\n              return (a.creationTime || 0) - (b.creationTime || 0);\n            });\n            return cookies[0];\n          });\n          return handlePromiseCallback(promise, callback);\n        },\n\n        getAll: function (details, callback) {\n          if (typeof _cookieList !== \"function\") {\n            return handlePromiseCallback(\n              Promise.reject(new Error(\"_cookieList not defined\")),\n              callback,\n            );\n          }\n          if (details.partitionKey) {\n            _warn(\n              \"cookies.getAll: partitionKey is not fully supported in this environment.\",\n            );\n          }\n          const promise = _cookieList(details);\n          return handlePromiseCallback(promise, callback);\n        },\n\n        set: function (details, callback) {\n          const promise = (async () => {\n            if (\n              typeof _cookieSet !== \"function\" ||\n              typeof _cookieList !== \"function\"\n            ) {\n              throw new Error(\"_cookieSet or _cookieList not defined\");\n            }\n            if (details.partitionKey) {\n              _warn(\n                \"cookies.set: partitionKey is not fully supported in this environment.\",\n              );\n            }\n\n            const getDetails = {\n              url: details.url,\n              name: details.name,\n              storeId: details.storeId,\n            };\n            const oldCookies = await _cookieList(getDetails);\n            const oldCookie = oldCookies && oldCookies[0];\n\n            if (oldCookie) {\n              broadcastCookieChange({\n                cause: \"overwrite\",\n                cookie: oldCookie,\n                removed: true,\n              });\n            }\n\n            await _cookieSet(details);\n            const newCookies = await _cookieList(getDetails);\n            const newCookie = newCookies && newCookies[0];\n\n            if (newCookie) {\n              broadcastCookieChange({\n                cause: \"explicit\",\n                cookie: newCookie,\n                removed: false,\n              });\n            }\n            return newCookie || null;\n          })();\n          return handlePromiseCallback(promise, callback);\n        },\n\n        remove: function (details, callback) {\n          const promise = (async () => {\n            if (\n              typeof _cookieDelete !== \"function\" ||\n              typeof _cookieList !== \"function\"\n            ) {\n              throw new Error(\"_cookieDelete or _cookieList not defined\");\n            }\n            const oldCookies = await _cookieList(details);\n            const oldCookie = oldCookies && oldCookies[0];\n\n            if (!oldCookie) return null; // Nothing to remove\n\n            await _cookieDelete(details);\n\n            broadcastCookieChange({\n              cause: \"explicit\",\n              cookie: oldCookie,\n              removed: true,\n            });\n\n            return {\n              url: details.url,\n              name: details.name,\n              storeId: details.storeId || \"0\",\n              partitionKey: details.partitionKey,\n            };\n          })();\n          return handlePromiseCallback(promise, callback);\n        },\n\n        getAllCookieStores: function (callback) {\n          const promise = Promise.resolve([\n            { id: \"0\", tabIds: [1] }, // Mock store for the current context\n          ]);\n          return handlePromiseCallback(promise, callback);\n        },\n\n        getPartitionKey: function (details, callback) {\n          _warn(\n            \"chrome.cookies.getPartitionKey is not supported in this environment.\",\n          );\n          const promise = Promise.resolve({ partitionKey: {} }); // Return empty partition key\n          return handlePromiseCallback(promise, callback);\n        },\n\n        onChanged: {\n          addListener: (callback) => {\n            if (typeof callback === \"function\") {\n              cookieChangeListeners.add(callback);\n            }\n          },\n          removeListener: (callback) => {\n            cookieChangeListeners.delete(callback);\n          },\n        },\n      };\n    })(),\n    tabs: {\n      query: async (queryInfo) => {\n        _warn(\"chrome.tabs.query polyfill only returns current tab info.\");\n        const dummyId = Math.floor(Math.random() * 1000) + 1;\n        return [\n          {\n            id: dummyId,\n            url: CURRENT_LOCATION,\n            active: true,\n            windowId: 1,\n            status: \"complete\",\n          },\n        ];\n      },\n      create: async ({ url, active = true }) => {\n        _log(`[Polyfill tabs.create] URL: ${url}`);\n        if (typeof _openTab !== \"function\")\n          throw new Error(\"_openTab not defined\");\n        _openTab(url, active);\n        const dummyId = Math.floor(Math.random() * 1000) + 1001;\n        return Promise.resolve({\n          id: dummyId,\n          url: url,\n          active,\n          windowId: 1,\n        });\n      },\n      sendMessage: async (tabId, message) => {\n        _warn(\n          `chrome.tabs.sendMessage polyfill (to tab ${tabId}) redirects to runtime.sendMessage (current context).`,\n        );\n        return chrome.runtime.sendMessage(message);\n      },\n      onActivated: createNoopListeners(),\n      onUpdated: createNoopListeners(),\n      onRemoved: createNoopListeners(),\n      onReplaced: createNoopListeners(),\n      onCreated: createNoopListeners(),\n      onMoved: createNoopListeners(),\n      onDetached: createNoopListeners(),\n      onAttached: createNoopListeners(),\n    },\n    windows: {\n      onFocusChanged: createNoopListeners(),\n      onCreated: createNoopListeners(),\n      onRemoved: createNoopListeners(),\n      onFocused: createNoopListeners(),\n      onFocus: createNoopListeners(),\n      onBlur: createNoopListeners(),\n      onFocused: createNoopListeners(),\n    },\n    notifications: {\n      create: async (notificationId, options) => {\n        try {\n          let id = notificationId;\n          let notificationOptions = options;\n\n          if (typeof notificationId === \"object\" && notificationId !== null) {\n            notificationOptions = notificationId;\n            id = \"notification_\" + Math.random().toString(36).substring(2, 15);\n          } else if (typeof notificationId === \"string\" && options) {\n            id = notificationId;\n            notificationOptions = options;\n          } else {\n            throw new Error(\"Invalid parameters for notifications.create\");\n          }\n\n          if (!notificationOptions || typeof notificationOptions !== \"object\") {\n            throw new Error(\"Notification options must be an object\");\n          }\n\n          const {\n            title,\n            message,\n            iconUrl,\n            type = \"basic\",\n          } = notificationOptions;\n\n          if (!title || !message) {\n            throw new Error(\"Notification must have title and message\");\n          }\n\n          if (\"Notification\" in window) {\n            if (Notification.permission === \"granted\") {\n              const notification = new Notification(title, {\n                body: message,\n                icon: iconUrl,\n                tag: id,\n              });\n\n              _log(`[Notifications] Created notification: ${id}`);\n              return id;\n            } else if (Notification.permission === \"default\") {\n              const permission = await Notification.requestPermission();\n              if (permission === \"granted\") {\n                const notification = new Notification(title, {\n                  body: message,\n                  icon: iconUrl,\n                  tag: id,\n                });\n                _log(\n                  `[Notifications] Created notification after permission: ${id}`,\n                );\n                return id;\n              } else {\n                _warn(\"[Notifications] Permission denied for notifications\");\n                return id;\n              }\n            } else {\n              _warn(\"[Notifications] Notifications are blocked\");\n              return id;\n            }\n          } else {\n            _warn(\n              \"[Notifications] Native notifications not supported, using console fallback\",\n            );\n            _log(`[Notification] ${title}: ${message}`);\n            return id;\n          }\n        } catch (error) {\n          _error(\"[Notifications] Error creating notification:\", error.message);\n          throw error;\n        }\n      },\n      clear: async (notificationId) => {\n        _log(`[Notifications] Clear notification: ${notificationId}`);\n        // For native notifications, there's no direct way to clear by ID\n        // This is a limitation of the Web Notifications API\n        return true;\n      },\n      getAll: async () => {\n        _warn(\"[Notifications] getAll not fully supported in polyfill\");\n        return {};\n      },\n      getPermissionLevel: async () => {\n        if (\"Notification\" in window) {\n          const permission = Notification.permission;\n          return { level: permission === \"granted\" ? \"granted\" : \"denied\" };\n        }\n        return { level: \"denied\" };\n      },\n    },\n    contextMenus: {\n      create: (createProperties, callback) => {\n        try {\n          if (!createProperties || typeof createProperties !== \"object\") {\n            throw new Error(\"Context menu create properties must be an object\");\n          }\n\n          const { id, title, contexts = [\"page\"], onclick } = createProperties;\n          const menuId =\n            id || `menu_${Math.random().toString(36).substring(2, 15)}`;\n\n          if (!title || typeof title !== \"string\") {\n            throw new Error(\"Context menu must have a title\");\n          }\n\n          // Store menu items for potential use\n          if (!window._polyfillContextMenus) {\n            window._polyfillContextMenus = new Map();\n          }\n\n          window._polyfillContextMenus.set(menuId, {\n            id: menuId,\n            title,\n            contexts,\n            onclick,\n            enabled: createProperties.enabled !== false,\n          });\n\n          _log(\n            `[ContextMenus] Created context menu item: ${title} (${menuId})`,\n          );\n\n          // Try to register a menu command as fallback\n          if (typeof _registerMenuCommand === \"function\") {\n            try {\n              _registerMenuCommand(\n                title,\n                onclick ||\n                  (() => {\n                    _log(`Context menu clicked: ${title}`);\n                  }),\n              );\n            } catch (e) {\n              _warn(\n                \"[ContextMenus] Failed to register as menu command:\",\n                e.message,\n              );\n            }\n          }\n\n          if (callback && typeof callback === \"function\") {\n            setTimeout(() => callback(), 0);\n          }\n\n          return menuId;\n        } catch (error) {\n          _error(\"[ContextMenus] Error creating context menu:\", error.message);\n          if (callback && typeof callback === \"function\") {\n            setTimeout(() => callback(), 0);\n          }\n          throw error;\n        }\n      },\n      update: (id, updateProperties, callback) => {\n        try {\n          if (\n            !window._polyfillContextMenus ||\n            !window._polyfillContextMenus.has(id)\n          ) {\n            throw new Error(`Context menu item not found: ${id}`);\n          }\n\n          const menuItem = window._polyfillContextMenus.get(id);\n          Object.assign(menuItem, updateProperties);\n\n          _log(`[ContextMenus] Updated context menu item: ${id}`);\n\n          if (callback && typeof callback === \"function\") {\n            setTimeout(() => callback(), 0);\n          }\n        } catch (error) {\n          _error(\"[ContextMenus] Error updating context menu:\", error.message);\n          if (callback && typeof callback === \"function\") {\n            setTimeout(() => callback(), 0);\n          }\n        }\n      },\n      remove: (menuItemId, callback) => {\n        try {\n          if (\n            window._polyfillContextMenus &&\n            window._polyfillContextMenus.has(menuItemId)\n          ) {\n            window._polyfillContextMenus.delete(menuItemId);\n            _log(`[ContextMenus] Removed context menu item: ${menuItemId}`);\n          } else {\n            _warn(\n              `[ContextMenus] Context menu item not found for removal: ${menuItemId}`,\n            );\n          }\n\n          if (callback && typeof callback === \"function\") {\n            setTimeout(() => callback(), 0);\n          }\n        } catch (error) {\n          _error(\"[ContextMenus] Error removing context menu:\", error.message);\n          if (callback && typeof callback === \"function\") {\n            setTimeout(() => callback(), 0);\n          }\n        }\n      },\n      removeAll: (callback) => {\n        try {\n          if (window._polyfillContextMenus) {\n            const count = window._polyfillContextMenus.size;\n            window._polyfillContextMenus.clear();\n            _log(`[ContextMenus] Removed all ${count} context menu items`);\n          }\n\n          if (callback && typeof callback === \"function\") {\n            setTimeout(() => callback(), 0);\n          }\n        } catch (error) {\n          _error(\n            \"[ContextMenus] Error removing all context menus:\",\n            error.message,\n          );\n          if (callback && typeof callback === \"function\") {\n            setTimeout(() => callback(), 0);\n          }\n        }\n      },\n      onClicked: {\n        addListener: (callback) => {\n          if (!window._polyfillContextMenuListeners) {\n            window._polyfillContextMenuListeners = new Set();\n          }\n          window._polyfillContextMenuListeners.add(callback);\n          _log(\"[ContextMenus] Added click listener\");\n        },\n        removeListener: (callback) => {\n          if (window._polyfillContextMenuListeners) {\n            window._polyfillContextMenuListeners.delete(callback);\n            _log(\"[ContextMenus] Removed click listener\");\n          }\n        },\n      },\n    },\n  };\n\n  const tc = (fn) => {\n    try {\n      fn();\n    } catch (e) {}\n  };\n  const loggingProxyHandler = (_key) => ({\n    get(target, key, receiver) {\n      tc(() => _log(`[${contextType}] [CHROME - ${_key}] Getting ${key}`));\n      return Reflect.get(target, key, receiver);\n    },\n    set(target, key, value, receiver) {\n      tc(() =>\n        _log(`[${contextType}] [CHROME - ${_key}] Setting ${key} to ${value}`),\n      );\n      return Reflect.set(target, key, value, receiver);\n    },\n    has(target, key) {\n      tc(() =>\n        _log(`[${contextType}] [CHROME - ${_key}] Checking if ${key} exists`),\n      );\n      return Reflect.has(target, key);\n    },\n  });\n  chrome = Object.fromEntries(\n    Object.entries(chrome).map(([key, value]) => [\n      key,\n      new Proxy(value, loggingProxyHandler(key)),\n    ]),\n  );\n\n  // Alias browser to chrome for common Firefox pattern\n  const browser = new Proxy(chrome, loggingProxyHandler);\n\n  const oldGlobalThis = globalThis;\n  const oldWindow = window;\n  const oldSelf = self;\n  const oldGlobal = globalThis;\n  const __globalsStorage = {};\n\n  const TO_MODIFY = [oldGlobalThis, oldWindow, oldSelf, oldGlobal];\n  const set = (k, v) => {\n    __globalsStorage[k] = v;\n    TO_MODIFY.forEach((target) => {\n      target[k] = v;\n    });\n  };\n  const proxyHandler = {\n    get(target, key, receiver) {\n      const fns = [\n        () => __globalsStorage[key],\n        () => Reflect.get(target, key, target),\n        () => target[key],\n      ];\n      const out = fns\n        .map((f) => {\n          try {\n            let out = f();\n            return out;\n          } catch (e) {\n            return undefined;\n          }\n        })\n        .find((f) => f !== undefined);\n      if (typeof out === \"function\") {\n        return out.bind(target);\n      }\n      return out;\n    },\n    set(target, key, value, receiver) {\n      try {\n        tc(() => _log(`[${contextType}] Setting ${key} to ${value}`));\n        set(key, value);\n        return Reflect.set(target, key, value, receiver);\n      } catch (e) {\n        _error(\"Error setting\", key, value, e);\n        try {\n          target[key] = value;\n          return true;\n        } catch (e) {\n          _error(\"Error setting\", key, value, e);\n        }\n        return false;\n      }\n    },\n    has(target, key) {\n      try {\n        return key in __globalsStorage || key in target;\n      } catch (e) {\n        _error(\"Error has\", key, e);\n        try {\n          return key in __globalsStorage || key in target;\n        } catch (e) {\n          _error(\"Error has\", key, e);\n        }\n        return false;\n      }\n    },\n    getOwnPropertyDescriptor(target, key) {\n      try {\n        if (key in __globalsStorage) {\n          return {\n            configurable: true,\n            enumerable: true,\n            writable: true,\n            value: __globalsStorage[key],\n          };\n        }\n        // fall back to the real globalThis\n        const desc = Reflect.getOwnPropertyDescriptor(target, key);\n        // ensure it's configurable so the with‑scope binding logic can override it\n        if (desc && !desc.configurable) {\n          desc.configurable = true;\n        }\n        return desc;\n      } catch (e) {\n        _error(\"Error getOwnPropertyDescriptor\", key, e);\n        return {\n          configurable: true,\n          enumerable: true,\n          writable: true,\n          value: undefined,\n        };\n      }\n    },\n\n    defineProperty(target, key, descriptor) {\n      try {\n        // Normalize descriptor to avoid mixed accessor & data attributes\n        const hasAccessor = \"get\" in descriptor || \"set\" in descriptor;\n\n        if (hasAccessor) {\n          // Build a clean descriptor without value/writable when accessors present\n          const normalized = {\n            configurable:\n              \"configurable\" in descriptor ? descriptor.configurable : true,\n            enumerable:\n              \"enumerable\" in descriptor ? descriptor.enumerable : false,\n          };\n          if (\"get\" in descriptor) normalized.get = descriptor.get;\n          if (\"set\" in descriptor) normalized.set = descriptor.set;\n\n          // Store accessor references for inspection but avoid breaking invariants\n          set(key, {\n            get: descriptor.get,\n            set: descriptor.set,\n          });\n\n          return Reflect.defineProperty(target, key, normalized);\n        }\n\n        // Data descriptor path\n        set(key, descriptor.value);\n        return Reflect.defineProperty(target, key, descriptor);\n      } catch (e) {\n        _error(\"Error defineProperty\", key, descriptor, e);\n        return false;\n      }\n    },\n  };\n\n  // Create proxies once proxyHandler is defined\n  const proxyWindow = new Proxy(oldWindow, proxyHandler);\n  const proxyGlobalThis = new Proxy(oldGlobalThis, proxyHandler);\n  const proxyGlobal = new Proxy(oldGlobal, proxyHandler);\n  const proxySelf = new Proxy(oldSelf, proxyHandler);\n\n  // Seed storage with core globals so lookups succeed inside `with` blocks\n  Object.assign(__globalsStorage, {\n    chrome,\n    browser,\n    window: proxyWindow,\n    globalThis: proxyGlobalThis,\n    global: proxyGlobal,\n    self: proxySelf,\n    document: oldWindow.document,\n  });\n\n  const __globals = {\n    chrome,\n    browser,\n    window: proxyWindow,\n    globalThis: proxyGlobalThis,\n    global: proxyGlobal,\n    self: proxySelf,\n    __globals: __globalsStorage,\n  };\n\n  __globals.contextId = contextId;\n  __globals.contextType = contextType;\n  __globals.module = undefined;\n  __globals.amd = undefined;\n  __globals.define = undefined;\n  __globals.importScripts = (...args) => {\n    _log(\"importScripts\", args);\n  };\n\n  return __globals;\n}\n\n\nif (typeof window !== 'undefined') {\n    window.buildPolyfill = buildPolyfill;\n}\n"
			  let newMap = JSON.parse(JSON.stringify(EXTENSION_ASSETS_MAP));
			  delete newMap[OPTIONS_PAGE_PATH];
			  const PASS_ON = Object.fromEntries(
			    Object.entries({
			      LOCALE_KEYS,
			      INJECTED_MANIFEST,
			      USED_LOCALE,
			      EXTENSION_ICON,
			      CURRENT_LOCATION,
			      OPTIONS_PAGE_PATH,
			      CAN_USE_BLOB_CSP,
			      ALL_PERMISSIONS,
			      ORIGIN_PERMISSIONS,
			      EXTENSION_PERMISSIONS,
			      SCRIPT_NAME,
			      _base64ToBlob,
			      _getMimeTypeFromPath,
			      _isTextAsset,
			      _createAssetUrl,
			      _matchGlobPattern,
			      _isWebAccessibleResource,
			      _log,
			      _warn,
			      _error,
			    }).map((i) => {
			      let out = [...i];
			      if (typeof i[1] === "function") {
			        out[1] = i[1].toString();
			      } else {
			        out[1] = JSON.stringify(i[1]);
			      }
			      return out;
			    })
			  );
			  _log(PASS_ON);
			  return `
			    ${Object.entries(PASS_ON)
			      .map(
			        (i) =>
			          `const ${i[0]} = ${i[1]};\nwindow[${JSON.stringify(i[0])}] = ${i[0]}`
			      )
			      .join("\n")}
			
			        _log("Initialized polyfill", {${Object.keys(PASS_ON).join(", ")}})
			        ${polyfillString.replaceAll("{{EXTENSION_ASSETS_MAP}}", `JSON.parse(unescape(atob("${btoa(encodeURIComponent(JSON.stringify(EXTENSION_ASSETS_MAP)))}")))`)}
			
			        // Initialize the polyfill context for options page
			        const polyfillCtx = buildPolyfill({ isOtherPage: true });
			        const APPLY_TO = [window, self, globalThis];
			        for (const obj of APPLY_TO) {
			            obj.chrome = polyfillCtx.chrome;
			            obj.browser = polyfillCtx.browser;
			            obj.INJECTED_MANIFEST = ${JSON.stringify(INJECTED_MANIFEST)};
			        }
			    `;
			}
			
			async function main() {
			  _log(`Initializing...`, performance.now());
			
			  if (typeof _initStorage === "function") {
			    try {
			      _initStorage()
			        .then(() => {
			          _log(`Storage initialized.`);
			        })
			        .catch((e) => {
			          _error("Error during storage initialization:", e);
			        });
			    } catch (e) {
			      _error("Error during storage initialization:", e);
			    }
			  }
			
			  _log(`Starting content scripts...`);
			
			  const currentUrl = window.location.href;
			  let shouldRunAnyScript = false;
			  _log(`Checking URL: ${currentUrl}`);
			
			  if (
			    CONTENT_SCRIPT_CONFIGS_FOR_MATCHING &&
			    CONTENT_SCRIPT_CONFIGS_FOR_MATCHING.length > 0
			  ) {
			    for (const config of CONTENT_SCRIPT_CONFIGS_FOR_MATCHING) {
			      if (
			        config.matches &&
			        config.matches.some((pattern) => {
			          try {
			            const regex = convertMatchPatternToRegExp(pattern);
			            if (regex.test(currentUrl)) {
			              return true;
			            }
			            return false;
			          } catch (e) {
			            _error(`Error testing match pattern "${pattern}":`, e);
			            return false;
			          }
			        })
			      ) {
			        shouldRunAnyScript = true;
			        _log(`URL match found via config:`, config);
			        break;
			      }
			    }
			  } else {
			    _log(`No content script configurations found in manifest data.`);
			  }
			
			  if (shouldRunAnyScript) {
			    let polyfillContext;
			    try {
			      polyfillContext = buildPolyfill({ isBackground: false });
			    } catch (e) {
			      _error(`Failed to build polyfill:`, e);
			      return;
			    }
			
			    _log(`Polyfill built. Executing combined script logic...`);
			    // async function executeAllScripts({chrome, browser, global, window, globalThis, self, __globals}, extensionCssData) {
			    await executeAllScripts.call(
			      polyfillContext.globalThis,
			      polyfillContext,
			      extensionCssData
			    );
			  } else {
			    _log(
			      `No matching content script patterns for this URL. No scripts will be executed.`
			    );
			  }
			
			  if (OPTIONS_PAGE_PATH) {
			    if (typeof _registerMenuCommand === "function") {
			      try {
			        _registerMenuCommand("Open Options", openOptionsPage);
			        _log(`Options menu command registered.`);
			      } catch (e) {
			        _error("Failed to register menu command", e);
			      }
			    }
			  }
			
			  if (POPUP_PAGE_PATH) {
			    if (typeof _registerMenuCommand === "function") {
			      try {
			        _registerMenuCommand("Open Popup", openPopupPage);
			        _log(`Popup menu command registered.`);
			      } catch (e) {
			        _error("Failed to register popup menu command", e);
			      }
			    }
			  }
			
			  _log(`Initialization sequence complete.`);
			}
			
			main()//.catch((e) => _error(`Error during script initialization:`, e));
			
			try {
			  const fnKey = "OPEN_OPTIONS_PAGE_" + String(SCRIPT_NAME).replace(/\s+/g, "_");
			  window[fnKey] = openOptionsPage;
			} catch (e) {}
			
			try {
			  const fnKey = "OPEN_POPUP_PAGE_" + String(SCRIPT_NAME).replace(/\s+/g, "_");
			  window[fnKey] = openPopupPage;
			} catch (e) {}
			
			
			})();
  // #endregion
  // #endregion
    // #endregion