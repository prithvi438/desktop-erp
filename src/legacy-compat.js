'use strict';
const fs=require('node:fs'),path=require('node:path');
for(const [current,legacy] of [['DESKTOP_ERP_DATA_DIR','SPEEDOONE_DATA_DIR'],['DESKTOP_ERP_PG_URL','SPEEDOONE_PG_URL']])if(!process.env[current]&&process.env[legacy])process.env[current]=process.env[legacy];
function profileDirectory(appData){const legacy=path.join(appData,'speedoone-pos');return fs.existsSync(legacy)?legacy:path.join(appData,'desktop-erp');}
const legacyBackupFormat='speedoone-postgres-backup';
module.exports={profileDirectory,legacyBackupFormat};
