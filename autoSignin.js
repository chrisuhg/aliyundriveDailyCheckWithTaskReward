/*
cron "0 9 * * *" autoSignin.js, tag=阿里云盘签到
*/

const axios = require('axios');
const { initInstance, getEnv, updateCkEnv } = require('./qlApi.js');
const notify = require('./sendNotify');

const updateAccesssTokenURL = 'https://auth.aliyundrive.com/v2/account/token';
const signinURL = 'https://member.aliyundrive.com/v1/activity/sign_in_list?_rx-s=mobile';
const taskInfoURL = 'https://member.aliyundrive.com/v2/activity/sign_in_info';
const rewardURL = 'https://member.aliyundrive.com/v1/activity/sign_in_reward?_rx-s=mobile';
const taskrewardURL = 'https://member.aliyundrive.com/v1/activity/sign_in_task_reward?_rx-s=mobile';

// 使用 refresh_token 更新 access_token
function updateAccesssToken(queryBody, remarks) {
    const errorMessage = [remarks, '更新 access_token 失败'];
    return axios(updateAccesssTokenURL, {
        method: 'POST',
        data: queryBody,
        headers: { 'Content-Type': 'application/json' }
    })
        .then(d => d.data)
        .then(d => {
            const { code, message, nick_name, refresh_token, access_token } = d;
            if (code) {
                if (
                    code === 'RefreshTokenExpired' ||
                    code === 'InvalidParameter.RefreshToken'
                )
                    errorMessage.push('refresh_token 已过期或无效');
                else errorMessage.push(message);
                return Promise.reject(errorMessage.join(', '));
            }
            return { nick_name, refresh_token, access_token };
        })
        .catch(e => {
            errorMessage.push(e.message);
            return Promise.reject(errorMessage.join(', '));
        });
}

// 获取任务列表
function getTaskList(access_token) {
    let data = JSON.stringify({});

    return axios(taskInfoURL, {
        method: 'POST',
        maxBodyLength: Infinity,
        data: data,
        headers: {
            Authorization: access_token,
            'Content-Type': 'application/json'
        }
    })
        .then(d => d.data)
        .then(json => {
            if (!json.success) {
                return Promise.reject(json.message);
            }
            return json.result;
        });
}

// 签到并搜索可领取的任务奖励
function sign_in(access_token, remarks) {
    const sendMessage = [remarks];
    return axios(signinURL, {
        method: 'POST',
        data: {
            isReward: false
        },
        headers: {
            Authorization: access_token,
            'Content-Type': 'application/json'
        }
    })
        .then(d => d.data)
        .then(async json => {
            if (!json.success) {
                sendMessage.push('签到失败', json.message);
                return Promise.reject(sendMessage.join(', '));
            }

            // 当天任务列表
            const taskList = await getTaskList(access_token)

            sendMessage.push(`${taskList.year}年 ${taskList.month}${taskList.day}日 签到成功！\n「${taskList.blessing} - ${taskList.subtitle}」\n`);

            sendMessage.push(`本月累计签到 ${json.result.signInCount} 天`);

            // 日签奖励列表
            const dailyRewards = taskList.rewards.filter(v => v.type === 'dailySignIn');
            for await (dailyReward of dailyRewards) {
                if ( dailyReward.status === 'finished' ) {
                    const signInDay = taskList.signInDay;
                    try {
                        const daliyrewardInfo = await getReward(access_token, signInDay);
                        sendMessage.push(
                            `第${signInDay}天日签奖励领取成功: 获得${daliyrewardInfo.name || ''}${
                                daliyrewardInfo.description || ''
                            }`
                        );
                    } catch (e) {
                        sendMessage.push(`第${signInDay}天日签奖励领取失败:`, e);
                    }
                }else if ( dailyReward.status === 'verification' ){
                    sendMessage.push(
                        `今日签到获得${dailyReward.name || ''}`
                    );
                }
            }

            // 每日任务奖励列表
            const taskRewards = taskList.rewards.filter(v => v.type === 'dailyTask');
            for await (taskReward of taskRewards){
                if( taskReward.status === 'finished' ){
                    try{
                        const signInDay = taskList.signInDay;
                        const taskrewardInfo = await getTaskReward( access_token, signInDay )
                        sendMessage.push(
                            `第${signInDay}天每日任务奖励领取成功: 获得${taskrewardInfo.name || ''}${
                                taskrewardInfo.notice || ''
                            }`
                        );
                    } catch (e){
                        sendMessage.push(`第${signInDay}天日签奖励领取失败:`, e);
                    }
                }else if( taskReward.status === 'verification' ){
                    sendMessage.push(
                        `今日任务获得${taskReward.name || ''}`
                    );
                }else if ( taskReward.status === 'unfinished' ){
                    sendMessage.push(
                        `每日任务尚未完成：${taskReward.remind || ''}`
                    );
                }
            }

            // 其他未完成任务
            const unfinisheds = taskList.rewards.filter(v => v.status === 'unfinished' && v.type !== 'dailySignIn' && v.type !== 'dailyTask');
            for ( unfinished of unfinisheds ){
                console.log(`其他未完成任务：[${unfinished.name}]${unfinished.remind}`)
            }

            return sendMessage.join('\n');
        })
        .catch(e => {
            sendMessage.push('签到失败');
            sendMessage.push(e.message);
            return Promise.reject(sendMessage.join(', '));
        });
}

// 领取奖励
function getReward(access_token, signInDay) {
    return axios(rewardURL, {
        method: 'POST',
        data: { signInDay },
        headers: {
            authorization: access_token,
            'Content-Type': 'application/json'
        }
    })
        .then(d => d.data)
        .then(json => {
            if (!json.success) {
                return Promise.reject(json.message);
            }

            return json.result;
        });
}

// 获取任务奖励
function getTaskReward(access_token, signInDay) {
    let data = JSON.stringify({
        "signInDay": `${signInDay}`
    });

    return axios(rewardURL, {
        method: 'POST',
        url: taskrewardURL,
        data: data,
        headers: {
            Authorization: access_token,
            'Content-Type': 'application/json'
        }
    })
        .then(d => d.data)
        .then(json => {
            if (!json.success) {
                return Promise.reject(json.message);
            }
            return json.result;
        })
        .catch((error) => {
            if (error.response && error.response.status === 400 && error.response.data.code === 'RepeatExchange') {
                return error.response.data;
            } else {
                // Handle other errors
                console.error('Error:', error.message);
                return Promise.reject(error.message);
            }
        });
}

// 获取环境变量
async function getRefreshToken() {
    let instance = null;
    try {
        instance = await initInstance();
    } catch (e) {}

    let refreshToken = process.env.refreshToken || [];
    try {
        if (instance) refreshToken = await getEnv(instance, 'refreshToken');
    } catch (e) {}

    let refreshTokenArray = [];

    if (Array.isArray(refreshToken)) refreshTokenArray = refreshToken;
    else if (refreshToken.indexOf('&') > -1)
        refreshTokenArray = refreshToken.split('&');
    else if (refreshToken.indexOf('\n') > -1)
        refreshTokenArray = refreshToken.split('\n');
    else refreshTokenArray = [refreshToken];

    if (!refreshTokenArray.length) {
        console.log('未获取到refreshToken, 程序终止');
        process.exit(1);
    }

    return {
        instance,
        refreshTokenArray
    };
}

!(async () => {
    const { instance, refreshTokenArray } = await getRefreshToken();

    const message = [];
    let index = 1;
    for await (refreshToken of refreshTokenArray) {
        let remarks = refreshToken.remarks || `账号${index}`;
        const queryBody = {
            grant_type: 'refresh_token',
            refresh_token: refreshToken.value || refreshToken
        };

        try {
            const { nick_name, refresh_token, access_token } =
                await updateAccesssToken(queryBody, remarks);

            if (nick_name && nick_name !== remarks)
                remarks = `${nick_name}(${remarks})`;

            // 更新环境变量
            if (instance) {
                let params = {
                    name: refreshToken.name,
                    value: refresh_token,
                    remarks: refreshToken.remarks || nick_name // 优先存储原有备注信息
                };
                // 新版青龙api
                if (refreshToken.id) {
                    params.id = refreshToken.id;
                }
                // 旧版青龙api
                if (refreshToken._id) {
                    params._id = refreshToken._id;
                }
                await updateCkEnv(instance, params);
            }

            const sendMessage = await sign_in(access_token, remarks);
            console.log(sendMessage);
            console.log('\n');
            message.push(sendMessage);
        } catch (e) {
            console.log(e);
            console.log('\n');
            message.push(e);
        }
        index++;
    }
    await notify.sendNotify(`阿里云盘签到`, message.join('\n'));
})();
