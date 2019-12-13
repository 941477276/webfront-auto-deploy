const path = require('path');
// 需上传的压缩包的路径
const zipPath = '../node_deploy.zip';

// 发包配置
module.exports = {
  sshConfig: { // 具体配置见 https://www.npmjs.com/package/node-ssh
    host: '47.56.97.57', // 服务器地址
    username: 'root', // 服务器用户名
    privateKey: '../ecs-key-hongkong.pem', // 方式一：使用密钥文件连接服务器。连接服务器的密钥文件，一般是以.pem结尾
    // password: '', //方式二 用密码连接服务器
  },
  npmScript: 'npm run build', // 需要运行的npm脚本命令（如：npm run build），自动发包会在该命令执行完成后再执行
  deployPath: '/mnt/data/www/testNodeDeploy', // 服务器端前端包存储目录
  zipPath: path.resolve(__dirname, zipPath), // 要上传的压缩包路径
  zipStoragePath: '/mnt/data/www/aaa', // 服务器端压缩包存储目录， 默认为deployPath的上一级目录
  zipBackupName: '', // 服务器端压缩包备份名称，默认为 压缩包名称+_backup
};
