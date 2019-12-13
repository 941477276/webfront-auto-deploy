const path = require('path');
const node_ssh = require('node-ssh'); // 连接远端服务器
const shell = require('shelljs'); // 在本地执行shell命令
const chalk = require('chalk'); // 修改控制台中字符串的样式
const ora = require('ora'); // 优雅的进度等待插件(类似于loading)

const deployConfig = require('./deployConfig');

const ssh = new node_ssh();

/*
  连接服务器
 */
async function connectSSH() {
  try {
    console.log('开始连接服务器');
    await ssh.connect(deployConfig.sshConfig);
    console.log('服务器连接成功');
    //let pathObj = analysisPath();
  } catch (e) {
    console.log('连接服务器异常', e);
    process.exit();
  }
}

/*
  解析相关路径
 */
function analysisPath() {
  // 获取压缩包名字
  let zipName = deployConfig.zipPath.split('.')[0].split('\\');
  zipName = zipName[zipName.length - 1];
  // 压缩包后缀
  let zipSuffix = deployConfig.zipPath.split('.');
  zipSuffix = zipSuffix[zipSuffix.length - 1];
  // 获取发包目录的上一级目录
  let deployPathParentPath = getParentDirPath(deployConfig.deployPath);
  let obj = {
    zipName,
    zipSuffix,
    // 压缩包存储目录
    zipStorageDir: deployConfig.zipStoragePath ? deployConfig.zipStoragePath : deployPathParentPath,
    zipBackupName: deployConfig.zipBackupName ? deployConfig.zipBackupName : zipName + '_backup'
  };
  // console.log(obj);
  return obj;
}

/*
  获取指定目录的上一级目录
 */
function getParentDirPath(path) {
  let parentPath = path.split('/');
  parentPath.pop();
  parentPath = parentPath.join('/');
  return parentPath;
}

/*
  根据文件夹路径获取文件夹名称
 */
function getDirNameByPath(path) {
  let pathArr = path.split('/');
  let dirName = pathArr[pathArr.length - 1];
  return dirName;
}

/*
  判断文件或目录是否存在于指定文件夹
 */
async function fileOrDirExistInDir(fileOrDir, dirPath) {
  // 获取回来的目录列表是以 \n 进行分割的
  let fileList = await execCommand('ls', dirPath);
  fileList = fileList.split('\n');

  // 判断文件或目录是否存在
  let fileOrDirExist = fileList.indexOf(fileOrDir) > -1;
  return fileOrDirExist;
}

/*
  判断文件夹是否为空
 */
async function isDirEmpty(dirPath) {
  let fileNum = await execCommand('ls -l ./|grep "^-"|wc -l', dirPath);
  let dirNum = await execCommand('ls -l ./|grep "^d"|wc -l', dirPath);
  // console.log('num', fileNum, dirNum, fileNum == 0 && dirNum == 0);
  return (fileNum == 0 && dirNum == 0);
}

/*
  在服务器上执行xshell脚本命令
 */
function execCommand(commandStr, cwd) {
  if (cwd) {
    // 传递了 cwd 属性表示进入指定目录并执行commandStr命令，如果没有指定目录则默认为登录的用户目录
    return ssh.exec(commandStr, [], {cwd});
  } else {
    return ssh.exec(commandStr);
  }
}

/*
  部署至服务器
 */
async function deployBySSH() {
  await connectSSH();

  let pathObj = analysisPath();
  console.log('准备上传压缩包!');
  let deployDirName = getDirNameByPath(deployConfig.deployPath);
  let zipStorageDirName = getDirNameByPath(pathObj.zipStorageDir);
  // 存放前端代码目录的父级目录
  let deployDirParent = getParentDirPath(deployConfig.deployPath);
  let zipStorageDirParent = getParentDirPath(pathObj.zipStorageDir);
  // 判断存放前端代码目录是否存在
  let deployDirExist = await fileOrDirExistInDir(deployDirName, deployDirParent);
  let zipDirExist = await fileOrDirExistInDir(zipStorageDirName, zipStorageDirParent);
  // 压缩包名称
  let zipFileFullName = `${pathObj.zipName}.${pathObj.zipSuffix}`;
  // 压缩包在服务端存储的路径
  let zipStorageFullPath = pathObj.zipStorageDir + `/${zipFileFullName}`;
  // 上传压缩包并解压
  let uploadFileAndUnzip = async function () {
    const spinner = ora('压缩包上传中...');
    await ssh.putFile(deployConfig.zipPath, zipStorageFullPath);
    spinner.stop();

    console.log(chalk.green('压缩包上传成功'));
    if (deployDirExist) {
      let dirEmpty = await isDirEmpty(deployConfig.deployPath);
      console.log('dirEmpty', dirEmpty);
      if (dirEmpty) {
        console.log('执行解压压缩包命令');
        await execCommand(`unzip -o ${zipFileFullName} -d ${deployConfig.deployPath}`, pathObj.zipStorageDir);
        console.log(chalk.green('解压压缩包完成，发包完成！'));
      } else {
        console.log('清空前端代码目录', deployConfig.deployPath);
        await execCommand('rm * -r', deployConfig.deployPath);
        console.log('执行解压压缩包命令');
        await execCommand(`unzip -o ${zipFileFullName} -d ${deployConfig.deployPath}`, pathObj.zipStorageDir);
        console.log(chalk.green('解压压缩包完成，发包完成！'));
      }
    } else {
      console.log('创建前端代码目录');
      await execCommand(`mkdir ${deployDirName}`, deployDirParent);
      console.log('执行解压压缩包命令');
      await execCommand(`unzip -o ${zipFileFullName} -d ${deployConfig.deployPath}`, pathObj.zipStorageDir);
      console.log(chalk.green('解压压缩包完成，发包完成！'));
    }
    process.exit(); // 退出流程
  };

  /* 如果压缩包存放目录与前端代码的目录一致
    1、判断前端代码目录是否存在，如果不存在则新建该目录
    2、再判断前端代码的目录里面是否有压缩包，如果有则将其拷贝到上一层目录并重命名，作为备份。
    3、然后将前端代码目录里面的文件清空，再把压缩包上传到该目录中
    3、执行解压压缩包命令
    4、将之前拷贝到上一层目录的备份压缩包剪切到前端代码目录中
   */
  if (pathObj.zipStorageDir === deployConfig.deployPath) {
    // 压缩包在服务端存储的路径2
    let zipStorageFullPath2 = deployConfig.deployPath + `/${zipFileFullName}`;
    // 上传文件并解压
    let uploadZipAndUnzip = async function () {
      //console.log('正在上传zip文件');
      const spinner = ora('压缩包上传中...');
      // 上传文件
      await ssh.putFile(deployConfig.zipPath, zipStorageFullPath2);
      spinner.stop();
      console.log(chalk.green('压缩包上传成功'));
      console.log('执行解压压缩包命令');
      await execCommand(`unzip -o ${zipFileFullName} -d ${deployConfig.deployPath}`, pathObj.zipStorageDir);
      console.log(chalk.green('解压压缩包完成，发包完成！'));
    };

    if (deployDirExist) {
      let zipFileExist = await fileOrDirExistInDir(zipFileFullName, deployConfig.deployPath);
      let dirEmpty = await isDirEmpty(deployConfig.deployPath);


      if (zipFileExist) {
        // 将旧的压缩包重命名
        await execCommand(`mv ${zipFileFullName} ${zipFileFullName}.bak`, deployConfig.deployPath);
        // 将重命名后的旧压缩包移动到上一层目录，以作备份
        await execCommand(`mv ${zipFileFullName}.bak ${deployDirParent}`, deployConfig.deployPath);
        console.log('清空前端代码目录', deployConfig.deployPath);
        // 清空前端代码目录
        await execCommand('rm * -r', deployConfig.deployPath);
        await uploadZipAndUnzip();
        // 将移动到上一层目录的备份压缩包文件移动回前端代码目录，移动前先进行重命名
        await execCommand(`mv ${zipFileFullName}.bak ${pathObj.zipBackupName}.${pathObj.zipSuffix}`, deployDirParent);
        console.log('将移动到上一层目录的备份压缩包文件进行重命名');
        await execCommand(`mv ${pathObj.zipBackupName}.${pathObj.zipSuffix} ${deployConfig.deployPath}`, deployDirParent);
        console.log('将移动到上一层目录的备份压缩包文件移动回前端代码目录');
      } else {
        if (!dirEmpty) {
          console.log('清空前端代码目录', deployConfig.deployPath);
          // 清空前端代码目录
          await execCommand('rm * -r', deployConfig.deployPath);
        }
        await uploadZipAndUnzip();
      }
    } else {
      console.log('创建前端代码目录');
      await execCommand(`mkdir ${deployDirName}`, deployDirParent);
      await uploadZipAndUnzip();
    }

    process.exit();
  } else {
    /*
      如果压缩包存放目录与前端代码目录不一致
      1、判断压缩包存放目录是否存在，如果不存在则新建该目录，并将压缩包上传至该目录
      2、判断压缩包存放目录中是否已有压缩包，如果有则将其备份并重命名
      3、删除原来的压缩包，并将压缩包上传至该目录
      4、判断前端代码目录是否存在，如果不存在则新建该目录，如果存在则将该目录清空
      5、将上传的压缩包解压到前端代码目录中
     */
    if (zipDirExist) {
      let zipExist = await fileOrDirExistInDir(zipFileFullName, pathObj.zipStorageDir);
      if (zipExist) {
        // 备份原先的压缩包
        await execCommand(`cp ${zipFileFullName} ${pathObj.zipBackupName}.${pathObj.zipSuffix}`, pathObj.zipStorageDir);
        // 删除原先的压缩包
        await execCommand(`sudo rm -f ${zipFileFullName}`, pathObj.zipStorageDir);
        await uploadFileAndUnzip();
      } else {
        await uploadFileAndUnzip();
      }
    } else {
      // console.log('存储压缩包文件夹不存在，立即创建该文件夹');
      // 存储压缩包文件夹不存在，立即创建该文件夹
      await execCommand(`mkdir ${zipStorageDirName}`, zipStorageDirParent);
      await uploadFileAndUnzip();
    }
  }
}

/*
  发布
 */
async function deploy() {
  if(deployConfig.npmScript){
    // 使用shell插件进入本地项目根目录
    shell.cd(path.resolve(__dirname, '../'));
    console.log(chalk.cyan(`开始运行 ${deployConfig.npmScript} 命令`));
    const shellRes = await shell.exec(deployConfig.npmScript);
    if (shellRes.code == 0) {
      console.log(chalk.cyan(`${deployConfig.npmScript} 命令运行完成，开始走发包流程`));
      try {
        await deployBySSH();

        let timer = setTimeout(() => {
          clearTimeout(timer);
          shell.exec('exit'); // 关闭命令行，这里不知道为什么走不了
        }, 1000);
      }catch (e) {
        process.exit(); // 退出流程
        console.log(chalk.red('自动发包失败！'));
        console.log(chalk.red(e));
      }
    } else {
      console.log(chalk.red(`${deployConfig.npmScript} 命令运行出错，请检查！`));
      process.exit(); // 退出流程
    }
  }else{
    try {
      await deployBySSH();

      let timer = setTimeout(() => {
        clearTimeout(timer);
        shell.exec('exit'); // 关闭命令行，这里不知道为什么走不了
      }, 1000);
    }catch (e) {
      process.exit(); // 退出流程
      console.log(chalk.red('自动发包失败！'));
      console.log(chalk.red(e));
    }
  }
}

//connectSSH();
//analysisPath();
//deployBySSH();

deploy();
