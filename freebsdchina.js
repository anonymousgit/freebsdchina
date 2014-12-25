/*global $, phantom, window */

var fs = require('fs'),
    async = require('./async'),
    system = require('system'),
    page = require("webpage").create(),
    jqueryJS  = fs.workingDirectory +  '/jquery-1.11.1.min.js';

var listUrl = [
    'https://www.freebsdchina.org/forum/forum_27.html',
    // 'https://www.freebsdchina.org/forum/forum_3.html',
    // 'https://www.freebsdchina.org/forum/forum_65.html'
    ];

var configJSON = fs.read('freebsdchina.config.json'),
    config = JSON.parse(configJSON);

var freebsdchina = {},
    previousRequestMethod,
    allPostsOutput = 'freebsdchina.posts.json',
    spamOutput = 'freebsdchina.spam.json',
    abortRequestOutput = 'freebsdchina.abortRqeuest.json',
    abortRequest = [],
    allPosts = [],
    noImage = true,
    showConsoleMessage = true,
    testUrl = 'https://www.freebsdchina.org/forum/forum_27.html';

page.viewportSize = { width: 1024, height: 768 };
page.settings.userAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/39.0.2171.42 Safari/537.36';

freebsdchina.checkRequestUrl = function (url) {
    'use strict';
    var r = !url.match(/^http(?:s|):\/\/www\.freebsdchina\.org/);
    return r;
};

freebsdchina.getLoginButton = function (url, callback) {
    'use strict';
    page.open(url, function (status) {
        var result;
        if (status === 'success') {
            if (page.injectJs(jqueryJS)) {
                result =  page.evaluate(function () {
                    var login = $('a').filter(function () {
                        return $(this).text() === '登录';
                    }).get(0);

                    console.log($(login).prop('href'));
                    return $(login).offset();
                });
            }
        } else {
            console.log(url + ': ' + status);
            phantom.exit();
        }
        callback(result);
    });
};

freebsdchina.fetchList = function (url, callback) {
    'use strict';
    page.open(url, function (status) {
        var result;
        if (status === 'success') {
            if (page.injectJs(jqueryJS)) {
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
                                    if (m[1] > pageStartMax) {
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
            }
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
            if (page.injectJs(jqueryJS)) {
                result =  page.evaluate(function (opt) {

                    var posts = [],
                        postOptions = {},
                        previousPostId = 0,
                        tbody;

                    tbody = $('tr > th').filter(function () {
                        return $(this).text() === '留言';
                    }).parent().parent();

                    if (opt) {
                        console.log('inside evaluate: ' + opt);
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
            }
        } else {
            console.log(url + ': ' + status);
        }
        callback(result);
    });
};

freebsdchina.loadLoginPage = function (callback) {
    'use strict';
    freebsdchina.getLoginButton(testUrl, function (login) {
        console.log(JSON.stringify(login, undefined, 4));
        page.sendEvent('click', login.left + 3, login.top + 1);

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
            if (page.injectJs(jqueryJS)) {
                var r =  page.evaluate(function () {
                    var pos = {};
                    pos.username = $('input[name=username]').offset();
                    pos.password = $('input[name=password]').offset();
                    pos.autologin = $('input[name=autologin]').offset();
                    pos.login = $('input[name=login]').offset();
                    return pos;
                });
                console.log(JSON.stringify(r, undefined, 4));

                page.sendEvent('click', r.username.left + 1, r.username.top);
                page.sendEvent('keypress', config.login.username);
                page.sendEvent('click', r.password.left + 1, r.password.top);
                page.sendEvent('keypress', config.login.password);
                page.sendEvent('click', r.autologin.left + 1, r.autologin.top);
                page.sendEvent('click', r.login.left + 3, r.login.top + 3);

                page.onLoadFinished = function (status) {
                    if (status === 'success') {
                        callback();
                    }
                };
            }
        }
    });
};

freebsdchina.checkLoginStatus = function (callback) {
    'use strict';
    if (page.frameUrl.match(/index\.php/)) {
        if (page.injectJs(jqueryJS)) {
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
                        console.log('Username match');
                    } else {
                        loginError.push('Username mismatch: |' + m[1]  + '|');
                    }
                } else {
                    loginError.push('Logout String mismatch');
                }

                logoutUrl = $(login).prop('href');
                if (logoutUrl.match(/login\.php\?logout=true/)) {
                    urlMatch = true;
                    console.log('urlMatch');
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
        }
    }
};

freebsdchina.deletePost = function (deleteUrl, callback) {
    'use strict';
    page.open(deleteUrl, function (status) {
        var confirmButton;
        if (status === 'success') {
            if (page.injectJs(jqueryJS)) {
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
                    page.sendEvent('click', confirmButton.left + 1, confirmButton.top + 1);

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
            }
        } else {
            console.log(deleteUrl + ': ' + status);
            phantom.exit();
        }
    });
};

page.onResourceRequested = function (requestData, request) {
    'use strict';
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
        console.log('Requested: ' + requestData.url);
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

function syncList(url, callback) {
    'use strict';
    var listOutput, m;
    m = url.match(/_(\d+)\.html/);
    if (m && m[1]) {
        listOutput = 'freebsdchina.list.' + m[1] + '.json';
        console.log('Updated ' + listOutput);

        freebsdchina.fetchList(url, function (result) {
            var posts = [];
            fs.write(listOutput, JSON.stringify(result, undefined, 4), 'w');

            result.forEach(function (entry) {
                if (entry.hasOwnProperty('pages')) {
                    entry.pages.forEach(function (link) {
                        posts.push(link);
                    });
                } else {
                    posts.push(entry.url);
                }
            });
            callback(posts);
        });
    }
}

function syncPost(url, callback) {
    'use strict';
    freebsdchina.fetchPost(url, function (post) {
        post.forEach(function (entry) {
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

function syncAll(url, callback) {
    'use strict';
    syncList(url, function (posts) {
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

var target = system.args[1];

if (target === 'sync') {
    showConsoleMessage = false;
    freebsdchina.doLogin(function () {
        'use strict';
        freebsdchina.checkLoginStatus(function (loginStatus) {
            console.log(JSON.stringify(loginStatus, undefined, 4));

            if (loginStatus.success) {
                async.mapSeries(listUrl, syncAll, function () {
                    fs.write(allPostsOutput, JSON.stringify(allPosts, undefined, 4), 'w');
                    console.log('Updated ' + allPostsOutput);
                    exit();
                });
            } else {
                console.log('login failed');
                exit();
            }
        });
        page.onLoadFinished = function () { return; };
    });
}

function doListSpam() {
    'use strict';
    var postsJSON = fs.read(allPostsOutput),
        posts = JSON.parse(postsJSON),
        spamPosts = [];

    posts.forEach(function (entry) {
        if (config.spamAuthors.indexOf(entry.author) !== -1) {
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

if (target === 'deletespam') {
    freebsdchina.doLogin(function () {
        'use strict';
        freebsdchina.checkLoginStatus(function (loginStatus) {
            console.log(JSON.stringify(loginStatus, undefined, 4));
            if (loginStatus.success) {

                var spamPosts = fs.read(spamOutput),
                    posts = JSON.parse(spamPosts),
                    deleteUrl =  [];

                posts.forEach(function (entry) {
                    deleteUrl.push(entry.deleteUrl);
                });

                async.mapSeries(deleteUrl.sort().reverse(), deletePost, function () {
                    console.log('Done');
                    exit();
                });
            } else {
                console.log('login failed');
                exit();
            }
        });
    });
}

