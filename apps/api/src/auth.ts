import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { redisStorage } from '@better-auth/redis-storage';
import { APIError } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins';
import nodemailer from 'nodemailer';
import { db,redis } from './infrastructure.js';
import { config } from './config.js';
const mail=nodemailer.createTransport({host:config.SMTP_HOST??'127.0.0.1',port:config.SMTP_PORT,secure:config.SMTP_SECURE==='true',
  ...(config.SMTP_USER?{auth:{user:config.SMTP_USER,pass:config.SMTP_PASSWORD}}:{}),connectionTimeout:5000,socketTimeout:10000});
const send = (email:string,subject:string,url:string) => {
  void mail.sendMail({from:config.SMTP_FROM,to:email,subject,text:subject+'\n\n'+url})
    .catch(()=>console.error(JSON.stringify({event:'mail_delivery_failed'})));
};
export const auth=betterAuth({
  logger:{disabled:true},
  appName:'照见 Star Oracle',baseURL:config.API_PUBLIC_URL,basePath:'/api/auth',secret:config.AUTH_SECRET,
  trustedOrigins:[config.WEB_ORIGIN],
  database:prismaAdapter(db,{provider:'mysql'}),
  secondaryStorage:redisStorage({client:redis,keyPrefix:'auth:'}),
  user:{additionalFields:{role:{type:'string',defaultValue:'user',input:false},disabled:{type:'boolean',defaultValue:false,input:false}},
    deleteUser:{enabled:true,beforeDelete:async user=>{const current=await db.user.findUnique({where:{id:user.id}});if(current?.role==='admin')throw new APIError('FORBIDDEN',{message:'Administrator deletion requires offline maintenance'});}}},
  databaseHooks:{user:{create:{before:async user=>{if(user.name.length>100||user.email.length>191)throw new APIError('BAD_REQUEST',{message:'Account fields are too long'});return {data:user};}}}},
  session:{expiresIn:60*60*24*7,updateAge:60*60*12,storeSessionInDatabase:true,cookieCache:{enabled:false}},
  emailAndPassword:{enabled:true,minPasswordLength:12,maxPasswordLength:128,
    requireEmailVerification:config.REQUIRE_EMAIL_VERIFICATION==='true',revokeSessionsOnPasswordReset:true,
    sendResetPassword:async({user,url})=>send(user.email,'重设照见密码',url)},
  emailVerification:{sendOnSignUp:config.REQUIRE_EMAIL_VERIFICATION==='true',expiresIn:3600,
    sendVerificationEmail:async({user,url})=>send(user.email,'验证照见邮箱',url)},
  advanced:{useSecureCookies:config.NODE_ENV==='production',defaultCookieAttributes:{httpOnly:true,sameSite:'lax',path:'/'},
    ipAddress:{ipAddressHeaders:['x-real-ip']}},
  rateLimit:{enabled:true,storage:'secondary-storage',window:60,max:30,
    customRules:{'/sign-in/email':{window:60,max:5},'/sign-up/email':{window:60,max:3},'/request-password-reset':{window:60,max:3}}},
  plugins:[twoFactor({issuer:'照见 Star Oracle'})],
});
