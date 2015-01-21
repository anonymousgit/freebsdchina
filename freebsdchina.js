/*global $, phantom, window */

var fs = require('fs'),
    async = require('./async'),
    system = require('system'),
    page = require("webpage").create(),
    jqueryJS  = './jquery-1.11.1.min.js';

var listUrl = [
    'https://www.freebsdchina.org/forum/viewforum.php?f=27',
    'https://www.freebsdchina.org/forum/viewforum.php?f=65',
    'https://www.freebsdchina.org/forum/viewforum.php?f=3',
    'https://www.freebsdchina.org/forum/viewforum.php?f=50',
    'https://www.freebsdchina.org/forum/viewforum.php?f=77',
    'https://www.freebsdchina.org/forum/viewforum.php?f=68',
    'https://www.freebsdchina.org/forum/viewforum.php?f=58',
    // 'https://www.freebsdchina.org/forum/viewforum.php?f=46',
    'https://www.freebsdchina.org/forum/viewforum.php?f=64'
    ];

var config = {},
    spambotIdsJson = fs.read('freebsdchina.spambotIds.json'),
    loginJson = fs.read('freebsdchina.account.json'),
    freebsdchina = {},
    defaultViewportSize = { width: 1024, height: 768 },
    previousRequestMethod,
    abortRequest = [],
    allPosts = [],
    allIpAddrLog = [],
    noImage = true,
    showConsoleMessage = true,
    anonsync = false,
    cacheDir = 'cache',
    testUrl = 'https://www.freebsdchina.org/forum/forum_27.html',
    allPostsOutput = cacheDir + '/freebsdchina.posts.json',
    ipAddrOutput = cacheDir + '/freebsdchina.ipaddr.json',
    spamOutput = cacheDir + '/freebsdchina.spam.json',
    abortRequestOutput = cacheDir + '/freebsdchina.abortRqeuest.json';

config.spambotIds = JSON.parse(spambotIdsJson);
config.login = JSON.parse(loginJson);

page.viewportSize = defaultViewportSize;
page.settings.userAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/39.0.2171.42 Safari/537.36';

freebsdchina.checkRequestUrl = function (url) {
    'use strict';
    var r = !url.match(/^http(?:s|):\/\/www\.freebsdchina\.org/);
    return r;
};

function loadjQuery(callback) {
    var load = page.evaluate(function () {
        var jQueryt = typeof $;
        if (jQueryt === 'undefined') {
            return true;
        }
        return false;
    });

    if (load) {
        if (page.injectJs(jqueryJS)) {
            console.log('loadjQuery: Loading ' + jqueryJS + ' successful');
            callback();
        } else {
            console.log('loadjQuery: Loading ' + jqueryJS + ' failed');
        }
    } else {
        callback();
    }
}

function doPressKey(str) {
    page.sendEvent('keypress', str);
}

function doClickButton(pos, fix) {
    'use strict';
    var button = {};
    if (pos.left > page.viewportSize.width) {
        page.viewportSize = { width: pos.left + 100, height: page.viewportSize.height };
    }
    if (pos.top > page.viewportSize.height) {
        page.viewportSize = { width: page.viewportSize.width, height: pos.top + 100 };
    }

    if (!fix) {
        fix = {};
        fix.left = 0;
        fix.top = 0;
    }
    button.left = pos.left + fix.left;
    button.top = pos.top + fix.top;

    // console.log('doClickButton: page.viewportSize: ' + JSON.stringify(page.viewportSize, undefined, 4));
    console.log('doClickButton: Clicking Button: ' + JSON.stringify(button, undefined, 4));

    // window.setTimeout(function () {
        page.sendEvent('click', button.left, button.top);

        if (
            page.viewportSize.width !== defaultViewportSize.width ||
                page.viewportSize.height !== defaultViewportSize.height
        ) {
            page.viewportSize = defaultViewportSize;
        }
    // }, 2000);
}

freebsdchina.getLoginButton = function (url, callback) {
    'use strict';
    page.open(url, function (status) {
        if (status === 'success') {
            loadjQuery(function () {
                var loginButton =  page.evaluate(function () {
                    var login = $('a').filter(function () {
                        return $(this).text() === '登录';
                    }).get(0);
                    console.log('getLoginButton: ' + $(login).prop('href'));
                    return $(login).offset();
                });
                callback(loginButton);
            });
        } else {
            console.log(url + ': ' + status);
            phantom.exit();
        }
    });
};

freebsdchina.fetchList = function (url, callback) {
    'use strict';
    page.open(url, function (status) {
        var result;
        if (status === 'success') {
            loadjQuery(function () {
                result =  page.evaluate(function () {
                    $('a').filter(function () {
                        return $(this).text() === '下一页';
                    }).each(function () {
                        console.log('Next Page URL: ' + $(this).prop('href'));
                    });

                    var list = [];
                    $('table tr').each(function () {
                        var post = {},
                            td = $(this).find('td'),
                            link,
                            t,
                            m,
                            tdAuthor,
                            tdLastTs,
                            pagesLink,
                            pageStartMax = 0,
                            start = 0;

                        if (td.length === 6) {
                            if ($(td[1]).find('a').length > 1) {
                                post.pages = [];
                            }

                            $(td[1]).find('a').each(function (index) {
                                link = $(this).prop('href');
                                link = link.replace(/&sid=.*/, '');
                                if (index === 0) {
                                    post.subject = $(this).text().trim();
                                    post.url = link;
                                    m = link.match(/viewtopic\.php\?t=(\d+)/);
                                    if (m && m[1]) {
                                        post.id = m[1];
                                    } else {
                                        console.log('DEBUG fetchList0: ' + link);
                                    }
                                } else {
                                    m = link.match(/start=(\d+)/);
                                    if (m && m[1] > pageStartMax) {
                                        pageStartMax = m[1];
                                    }
                                    pagesLink = link;
                                }
                            });

                            if (pageStartMax > 0) {
                                m = pagesLink.match(/(.*start=)(\d+)/);
                                link = m[1];
                                for (start = 0; start <= pageStartMax; start = start + 20) {
                                    if (post.pages.indexOf(link + start) === -1) {
                                        post.pages.push(link + start);
                                    }
                                }
                            }

                            post.reply = $(td[2]).text().trim();
                            tdAuthor = $(td[3]).find('a').get(0);
                            post.firstPostAuthor = $(tdAuthor).text().trim();
                            post.firstPostAuthorUrl = $(tdAuthor).prop('href').replace(/&sid=.*/, '');
                            post.read = $(td[4]).text().trim();
                            tdLastTs = $(td[5]).find('a').get(0);
                            post.lastPostTs = $(td[5]).clone().find('a').remove().end().text().trim();
                            post.lastPostAuthor = $(tdLastTs).text().trim();
                            post.lastPostAuthorUrl = $(tdLastTs).prop('href').replace(/&sid=.*/, '');
                            t = $(td[5]).find('a').get(1);
                            post.lastPostUrl = $(t).prop('href').replace(/&sid=.*/, '');
                            list.push(post);
                        }
                    });
                    return list;
                });
            });
        } else {
            console.log(url + ': ' + status);
            phantom.exit();
        }
        callback(result);
    });
};

freebsdchina.fetchPost = function (url, callback, options) {
    'use strict';
    var opt = JSON.stringify(options);
    page.open(url, function (status) {
        var result;
        if (status === 'success') {
            loadjQuery(function () {
                result =  page.evaluate(function (opt) {

                    var posts = [],
                        postOptions = {},
                        previousPostId = 0,
                        tbody;

                    tbody = $('tr > th').filter(function () {
                        return $(this).text() === '留言';
                    }).parent().parent();

                    if (opt) {
                        console.log('freebsdchina.fetchPost opt: ' + opt);
                        postOptions = JSON.parse(opt);
                    }

                    $(tbody).children('tr').each(function () {
                        if ($(this).children('td').length === 2) {
                            var left = $(this).children('td:first'),
                                right = $(this).children('td:last'),
                                row = $(this),
                                post = {},
                                topic;

                            if ($(left).find('span b').length) {
                                post.author = $(left).children('span:first').text();

                                topic = $(right).find('tr').get(0);
                                $(topic).find('td a').each(function () {
                                    var link = $(this).prop('href').replace(/&sid=.*/, ''),
                                        m = link.match(/viewtopic\.php\?p=(\d+)/);
                                    if (m && m[1]) {
                                        post.id = m[1];
                                        previousPostId = post.id;
                                        post.postUrl = link;

                                        if (
                                            postOptions.hasOwnProperty('postId') &&
                                                postOptions.postId
                                        ) {
                                            if (postOptions.postId !== post.id) {
                                                $(row).remove();
                                            }
                                        }

                                        if (
                                            postOptions.hasOwnProperty('idTag') &&
                                                postOptions.idTag
                                        ) {
                                            $(this).parent().prepend('<span class="nav">' + post.id + '</span>');
                                        }
                                        return;
                                    }

                                    m = link.match(/posting\.php\?mode=quote/);
                                    if (m) {
                                        post.replyUrl = link;
                                        return;
                                    }

                                    m = link.match(/posting\.php\?mode=editpost/);
                                    if (m) {
                                        post.editUrl = link;
                                        return;
                                    }

                                    m = link.match(/posting\.php\?mode=delete/);
                                    if (m) {
                                        post.deleteUrl = link;
                                        return;
                                    }

                                    m = link.match(/modcp\.php\?mode=ip/);
                                    if (m) {
                                        post.ipUrl = link;
                                    }

                                });
                                posts.push(post);
                            } else {
                                // <tr>返回页首
                                if (
                                    postOptions.hasOwnProperty('postId') &&
                                        postOptions.postId
                                ) {
                                    if (postOptions.postId !== post.id) {
                                        $(row).remove();
                                    }
                                }
                            }
                        } else {
                            // <td class="spaceRow" colspan="2" height="1">
                            if (
                                postOptions.hasOwnProperty('postId') &&
                                    postOptions.postId && previousPostId
                            ) {
                                if (postOptions.postId !== previousPostId) {
                                    $(this).remove();
                                }
                            }
                        }
                    });
                    return posts;
                }, opt);
            });
        } else {
            console.log(url + ': ' + status);
        }
        callback(result);
    });
};

freebsdchina.loadLoginPage = function (callback) {
    'use strict';
    freebsdchina.getLoginButton(testUrl, function (login) {
        // page.sendEvent('click', login.left + 3, login.top + 1);
        doClickButton(login, { left: 3, top: 1 });

        page.onLoadFinished = function (status) {
            if (status === 'success') {
                callback();
            }
        };
    });
};

freebsdchina.doLogin = function (callback) {
    'use strict';
    freebsdchina.loadLoginPage(function () {
        console.log('DEBUG doLogin0: ' + page.frameUrl);
        if (page.frameUrl.match(/login\.php/)) {
            loadjQuery(function () {
                var r =  page.evaluate(function () {
                    var pos = {};
                    pos.username = $('input[name=username]').offset();
                    pos.password = $('input[name=password]').offset();
                    pos.autologin = $('input[name=autologin]').offset();
                    pos.login = $('input[name=login]').offset();
                    return pos;
                });
                console.log(JSON.stringify(r, undefined, 4));

                // page.sendEvent('click', r.username.left + 1, r.username.top);
                async.series([
                    function(callback) {
                        doClickButton(r.username, { left: 1, top: 0 });
                        callback(null, 'focus username');
                    },
                    function(callback) {
                        // doPressKey(config.login.username);
                        page.sendEvent('keypress', config.login.username);
                        callback(null, 'type in username');
                    },
                    function(callback) {
                        doClickButton(r.password, { left: 1, top: 0 });
                        callback(null, 'focus password');
                    },
                    function(callback) {
                        page.sendEvent('keypress', config.login.password);
                        callback(null, 'type in password');
                    },
                    function(callback) {
                        doClickButton(r.autologin, { left: 1, top: 0 });
                        callback(null, 'select autologin');
                    },
                    function(callback) {
                        page.render('login.png');
                        callback(null, 'screenshot');
                    },
                    function(callback) {
                        doClickButton(r.login, { left: 3, top: 3 });
                        callback(null, 'click login button');
                    }
                ], function (err, results) {
                    console.log(JSON.stringify(results, undefined, 4));
                });
                // page.sendEvent('click', r.password.left + 1, r.password.top);
                // page.sendEvent('click', r.autologin.left + 1, r.autologin.top);
                // page.sendEvent('click', r.login.left + 3, r.login.top + 3);

                page.onLoadFinished = function (status) {
                    if (status === 'success') {
                        page.onLoadFinished = function () { return; };
                        callback();
                    }
                };
            });
        }
    });
};

freebsdchina.checkLoginStatus = function (callback) {
    'use strict';
    if (page.frameUrl.match(/index\.php/)) {
        loadjQuery(function () {
            var result = page.evaluate(function (username) {
                var testLogin = {},
                    login = $('a').filter(function () {
                        return $(this).text().trim().match(/注销\s+\[/);
                    }).get(0),
                    log = $('span').filter(function () {
                        return $(this).text().trim().match(/您上次访问时间是/);
                    }).get(0),
                    m,
                    logoutUrl;
                    urlMatch = false,
                    usernameMatch = false,
                    loginError = [];

                m = $(login).text().trim().match(/注销\s+\[\s+(.*)\s+\]/);
                if (m && m[1]) {
                    if (username === m[1]) {
                        // testLogin.username = m[1];
                        usernameMatch = true;
                    } else {
                        loginError.push('Username mismatch: |' + m[1]  + '|');
                    }
                } else {
                    loginError.push('Logout String mismatch');
                }

                logoutUrl = $(login).prop('href');
                if (logoutUrl.match(/login\.php\?logout=true/)) {
                    urlMatch = true;
                } else {
                    loginError.push('URL mismatch: |' + logoutUrl + '|');
                }

                if (urlMatch && usernameMatch) {
                    testLogin.success = true;
                } else {
                    testLogin.success = false;
                    if (loginError.length > 0) {
                        testLogin.error = loginError;
                    }
                }

                testLogin.message = $(log).text().trim().replace(/\t/, '');

                return testLogin;
            }, config.login.username);
            callback(result);
        });
    } else {
        page.render('test.png');
        console.log('checkLoginStatus: failed');
        window.setTimeout(function () {
            exit();
        }, 10000);
    }
};

freebsdchina.logIpAddr = function (postUrl, callback) {
    'use strict';
    var m,
        postId,
        ipAddrButton,
        log;

    m = postUrl.match(/viewtopic\.php\?p=(\d+)#/);
    if (m  && m[1]) {
        postId = m[1];

        freebsdchina.fetchPost(postUrl, function () {
            ipAddrButton =  page.evaluate(function (id) {
                var re = new RegExp('modcp\\.php\\?mode=ip&p=' + id);
                return $('a[href*=modcp]').filter(function () {
                    return $(this).prop('href').match(re);
                }).offset();
            }, postId);
            console.log('ipAddrButton: ' + JSON.stringify(ipAddrButton, undefined, 4));

            if (
                ipAddrButton &&
                    ipAddrButton.left > 0 &&
                    ipAddrButton.top > 0
            ) {
                page.render('logipaddr.png');
                // page.sendEvent('click', ipAddrButton.left + 1, ipAddrButton.top + 1);
                doClickButton(ipAddrButton, { left: 1, top: 1 });

                page.onLoadFinished = function (status) {
                    if (status !== 'success') {
                        console.log('freebsdchina.logIpAddr failed: ' + status);
                    }

                    loadjQuery(function () {
                        log = page.evaluate(function () {
                            var ipLog = {};
                            ipLog.addresses  = [];

                            $('tr span').filter(function () {
                                return $(this).text().match(/\d+\s+文章/);
                            }).each(function () {
                                var text = $(this).text().trim(),
                                    match = text.match(/((?:\d{1,3}\.){3}\d{1,3})\s+\[\s+\d+\s+文章\s+\]/);
                                if  (match && match[1]) {
                                    ipLog.addresses.push(match[1]);
                                } else{
                                    match = text.match(/(.*)\s+\[\s+\d+\s+文章\s+\]/);
                                    if (match && match[1]) {
                                        ipLog.author = match[1];
                                    }
                                }
                            });
                            return ipLog;
                        });
                        if (log.addresses.length > 0) {
                            log[postId] = log.addresses[0];
                        }
                        allIpAddrLog.push(log);
                        callback();
                    });
                };
            } else {
                console.log('freebsdchina.logIpAddr: ipAddrButton not found');
                callback();
            }
            
        }, {});
    };
};

freebsdchina.deletePost = function (deleteUrl, callback) {
    'use strict';
    page.open(deleteUrl, function (status) {
        var confirmButton;
        if (status === 'success') {
            loadjQuery(function () {
                confirmButton =  page.evaluate(function () {
                    // FIXME: 您确定要删除这个主题吗？
                    return $('input[name=confirm]').offset();
                });
                console.log('ConfirmButton: ' + JSON.stringify(confirmButton, undefined, 4));
                if (
                    confirmButton &&
                        confirmButton.left > 0 &&
                        confirmButton.top > 0
                ) {
                    // page.sendEvent('click', confirmButton.left + 1, confirmButton.top + 1);
                    doClickButton(confirmButton);

                    page.onLoadFinished = function (status) {
                        if (status !== 'success') {
                            console.log('freebsdchina.deletePost failed: ' + status);
                        }
                        callback();
                    };
                } else {
                    console.log('freebsdchina.deletePost: confirmButton not found');
                    callback();
                }
            });
        } else {
            console.log(deleteUrl + ': ' + status);
            phantom.exit();
        }
    });
};

page.onResourceRequested = function (requestData, request) {
    'use strict';
    var httpsUrl;

    if (freebsdchina.checkRequestUrl(requestData.url)) {
        if (abortRequest.indexOf(requestData.url) === -1) {
            abortRequest.push(requestData.url);
        }
        request.abort();
    } else if (requestData.url.match(/\.(?:gif|jpg|png|css)$/)) {
        if (noImage) {
            request.abort();
        }
    } else {
        if (requestData.url.match(/http:\/\/.*\.freebsdchina\.org/)) {
            httpsUrl = requestData.url.replace(/^http:/i, 'https:');
            request.changeUrl(httpsUrl);
            console.log('Requested(http): ' + httpsUrl);
        } else {
            console.log('Requested: ' + requestData.url);
        }

        previousRequestMethod = requestData.method;
        if (requestData.url.match(/login\.php/) && requestData.method !== 'GET') {
            console.log(JSON.stringify(requestData, undefined, 4));
        }
    }
};

page.onResourceReceived = function (responseData) {
    'use strict';
    if (responseData.stage === 'end') {
        if (responseData.url) {
            console.log('Received: ' + responseData.url);
            if (responseData.url.match(/(?:login|posting)\.php/)) {
                if (previousRequestMethod !== 'GET') {
                    console.log(JSON.stringify(responseData, undefined, 4));
                }
            }
        }
    }
};

// page.onUrlChanged = function (url) {
//     'use strict';
//     return;
// };

page.onConsoleMessage = function (msg) {
    'use strict';
    if (showConsoleMessage) {
        system.stderr.writeLine('Page Console: ' + msg);
    }
};

function time() {
    var t = new Date();
    return (t.getTime()-t.getMilliseconds())/1000;
}

function loadSavedList(id) {
    var re = new RegExp('freebsdchina.list.' + id + '\.(\\d+)\.json'),
        files = [];

    fs.list(cacheDir).forEach(function (entry) {
        if (entry.match(re)) {
            files.push(cacheDir + '/' + entry);
        }
    });
    return files.sort().reverse()[0];
}

function syncList(url, listOpts, callback) {
    'use strict';
    var listOutput,
        listOutputTs,
        listDeltaOutput,
        previousListJSON,
        previousListTmp,
        previousList = {},
        savedList,
        ts = time(),
        m;

    // m = url.match(/_(\d+)\.html/);
    m = url.match(/viewforum\.php\?f=(\d+)/);
    if (m && m[1]) {
        listOutput = cacheDir + '/freebsdchina.list.' + m[1] + '.' + ts + '.json';
        listDeltaOutput = cacheDir + '/freebsdchina.list.' + m[1] + '.delta.json';
        savedList = loadSavedList(m[1]);

        if (listOpts && listOpts.delta) {
            if (!fs.exists(savedList)) {
                console.log('Downloading all posts');
                listOpts.delta = false;
            }
        }

        if (listOpts && listOpts.delta) {
            console.log('Loading ' + savedList);
            previousListJSON = fs.read(savedList);
            previousListTmp = JSON.parse(previousListJSON);
            // console.log('syncList: ' + previousListTmp.length);
            previousListTmp.forEach(function (entry) {
                // console.log('syncList Tmp: ' + entry.id);
                previousList[entry.id] = entry;
            });
            console.log('syncList: Loaded ' + Object.keys(previousList).length);
        }

        freebsdchina.fetchList(url, function (result) {
            var posts = [];
            if (result.length > 0) {
                fs.write(listOutput, JSON.stringify(result, undefined, 4), 'w');
                console.log('Updated ' + listOutput + ': ' + result.length);
            } else {
                exit();
            }

            if (listOpts && listOpts.delta) {
                result.forEach(function (entry) {
                    var newPost = false;
                    if (previousList.hasOwnProperty(entry.id)) {
                        if (entry.reply !== previousList[entry.id].reply) {
                            // console.log(entry.reply + ' ' + previousList[entry.id].reply);
                            newPost = true;
                        }
                    } else {
                        newPost = true;
                    }

                    if (newPost) {
                        if (entry.hasOwnProperty('pages')) {
                            entry.pages.forEach(function (link) {
                                posts.push(link);
                                console.log('NEW: ' + link);
                            });
                        } else {
                            posts.push(entry.url);
                            console.log('NEW: ' + entry.url);
                        }
                    }
                });
                fs.write(listDeltaOutput, JSON.stringify(posts, undefined, 4), 'w');
            } else {
                result.forEach(function (entry) {
                    if (entry.hasOwnProperty('pages')) {
                        entry.pages.forEach(function (link) {
                            posts.push(link);
                        });
                    } else {
                        posts.push(entry.url);
                    }
                });
            }
            callback(posts);
        });
    }
}

function syncPost(url, callback) {
    'use strict';
    freebsdchina.fetchPost(url, function (post) {
        post.forEach(function (entry) {
            // add deleteUrl and editUrl for anonsync
            if (anonsync) {
                entry.deleteUrl = 'https://www.freebsdchina.org/forum/posting.php?mode=delete&p=' + entry.id;
                entry.editUrl = 'https://www.freebsdchina.org/forum/posting.php?mode=editpost&p=' + entry.id;
            }
            allPosts.push(entry);
        });
        callback();
    });
}

function screenCapturePost(url, callback) {
    'use strict';
    var m, postId;
    m = url.match(/viewtopic\.php\?p=(\d+)#/);
    if (m  && m[1]) {
        postId = m[1];

        freebsdchina.fetchPost(url, function () {
            window.setTimeout(function () {
                page.render(postId + '.jpg', {format: 'jpeg'});
                callback();
            }, 10000);
        }, {'postId': postId, 'idTag': true});
    }
}

function deletePost(url, callback) {
    'use strict';
    console.log('deletePost: ' + url);
    freebsdchina.deletePost(url, function () {
        page.onLoadFinished = function () { return; };
        callback();
    });
}

function doSyncDelta(url, callback) {
    'use strict';
    syncList(url, {delta: true}, function (posts) {
        async.mapSeries(posts, syncPost, function () {
            console.log('Done: ' + url);
            callback();
        });
    });
}

function doSync(url, callback) {
    'use strict';
    syncList(url, {delta: false}, function (posts) {
        async.mapSeries(posts, syncPost, function () {
            console.log('Done: ' + url);
            callback();
        });
    });
}

function exit() {
    'use strict';
    if (abortRequest.length > 0) {
        fs.write(abortRequestOutput, JSON.stringify(abortRequest, undefined, 4), 'w');
    }
    phantom.exit();
}

if (system.args.length !== 2) {
    console.log('Usage: test_freebsdchina.js target');
    phantom.exit(1);
}

if (!fs.exists(cacheDir)) {
    if (fs.makeDirectory(cacheDir) !== true) {
        console.log('mkdir ' + cacheDir + ' failed');
        phantom.exit(1);
    }
}

var target = system.args[1];

if (target === 'sync') {
    showConsoleMessage = false;
    freebsdchina.doLogin(function () {
        'use strict';
        freebsdchina.checkLoginStatus(function (loginStatus) {
            console.log(JSON.stringify(loginStatus, undefined, 4));

            if (loginStatus.success) {
                async.mapSeries(listUrl, doSync, function () {
                    fs.write(allPostsOutput, JSON.stringify(allPosts, undefined, 4), 'w');
                    console.log('Updated ' + allPostsOutput);
                    exit();
                });
            } else {
                console.log('login failed');
                exit();
            }
        });
    });
}

if (target === 'anonsync') {
    showConsoleMessage = false;
    anonsync = true;
    async.mapSeries(listUrl, doSync, function () {
        fs.write(allPostsOutput, JSON.stringify(allPosts, undefined, 4), 'w');
        console.log('Updated ' + allPostsOutput);
        exit();
    });
}

if (target === 'anonsyncdelta') {
    showConsoleMessage = false;
    anonsync = true;
    async.mapSeries(listUrl, doSyncDelta, function () {
        fs.write(allPostsOutput, JSON.stringify(allPosts, undefined, 4), 'w');
        console.log('Updated ' + allPostsOutput);
        exit();
    });
}

function saveLocalIpAddrLog(callback) {
    'use strict';
    var ipLogJSON,
        ipLog = {};

    if (allIpAddrLog.length > 0) {
        if (fs.exists(ipAddrOutput)) {
            ipLogJSON = fs.read(ipAddrOutput);
            ipLog = JSON.parse(ipLogJSON);
        }

        allIpAddrLog.forEach(function (log) {
            var author = log.author;
            if (ipLog.hasOwnProperty(author)) {
                log.addresses.forEach(function (ipaddr) {
                    if (ipLog[author].addresses.indexOf(ipaddr) === -1) {
                        ipLog[author].addresses.push(ipaddr);
                    }
                });
            } else {
                ipLog[author] = {};
                ipLog[author].posts = {};
                ipLog[author].addresses = log.addresses;
            }

            Object.keys(log).forEach(function (k) {
                if (k.match(/^\d+$/)) {
                    if (!ipLog[author].posts.hasOwnProperty(k)) {
                        ipLog[author].posts[k] = log[k];
                    }
                }
            });
        });
        fs.write(ipAddrOutput, JSON.stringify(ipLog, undefined, 4));
    }
    callback();
}

function doListSpam() {
    'use strict';
    var postsJSON = fs.read(allPostsOutput),
        posts = JSON.parse(postsJSON),
        spamPosts = [];

    posts.forEach(function (entry) {
        if (config.spambotIds.indexOf(entry.author) !== -1) {
            spamPosts.push(entry);
        }
    });
    fs.write(spamOutput, JSON.stringify(spamPosts, undefined, 4), 'w');
    console.log('Updated ' + spamOutput);
    phantom.exit();
}

if (target === 'listspam') {
    doListSpam();
}

function doLogIpAddr(postUrl, callback) {
    freebsdchina.logIpAddr(postUrl, function () {
        page.onLoadFinished = function () { return; };
        callback();
    });
}

function doScreenShot() {
    'use strict';
    var postsJSON = fs.read(spamOutput),
        posts = JSON.parse(postsJSON),
        spamPostsUrl = [];

    posts.forEach(function (entry) {
        spamPostsUrl.push(entry.postUrl);
    });
    console.log(JSON.stringify(spamPostsUrl, undefined, 4));
    noImage = false;
    async.mapSeries(spamPostsUrl, screenCapturePost, function () {
        console.log('Done');
        exit();
    });
}

if (target === 'screenshot') {
    doScreenShot();
}

if (target === 'logipaddr') {
    // noImage = false;
    freebsdchina.doLogin(function () {
        'use strict';
        freebsdchina.checkLoginStatus(function (loginStatus) {
            console.log(JSON.stringify(loginStatus, undefined, 4));
            if (loginStatus.success) {
                var spamPosts = fs.read(spamOutput),
                    posts = JSON.parse(spamPosts),
                    postUrl =  [];

                posts.forEach(function (entry) {
                    postUrl.push(entry.postUrl);
                });

                async.mapSeries(postUrl.sort().reverse(), doLogIpAddr, function () {
                    saveLocalIpAddrLog(function () {
                        console.log('Done');
                        exit();
                    });
                });
            } else {
                console.log('login failed');
                exit();
            }
        });
    });
}

if (target === 'deletespam') {
    freebsdchina.doLogin(function () {
        'use strict';
        freebsdchina.checkLoginStatus(function (loginStatus) {
            console.log(JSON.stringify(loginStatus, undefined, 4));
            if (loginStatus.success) {

                var spamPosts = fs.read(spamOutput),
                    posts = JSON.parse(spamPosts),
                    postUrl = [],
                    deleteUrl =  [];

                posts.forEach(function (entry) {
                    postUrl.push(entry.postUrl);
                    deleteUrl.push(entry.deleteUrl);
                });

                async.mapSeries(postUrl.sort().reverse(), doLogIpAddr, function () {
                    saveLocalIpAddrLog(function () {
                        async.mapSeries(deleteUrl.sort().reverse(), deletePost, function () {
                            console.log('Done');
                            exit();
                        });
                    });
                });
            } else {
                console.log('login failed');
                exit();
            }
        });
    });
}

