import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { redisStorage } from '@better-auth/redis-storage';
import { APIError } from 'better-auth/api';
import { twoFactor,username } from 'better-auth/plugins';
import { db,redis } from './infrastructure.js';
import { config } from './config.js';
export const auth=betterAuth({
  logger:{disabled:true},
  appName:'照见 Star Oracle',baseURL:config.API_PUBLIC_URL,basePath:'/api/auth',secret:config.AUTH_SECRET,
  trustedOrigins:[config.WEB_ORIGIN],
  database:prismaAdapter(db,{provider:'mysql'}),
  secondaryStorage:redisStorage({client:redis,keyPrefix:'auth:'}),
  user:{additionalFields:{role:{type:'string',defaultValue:'user',input:false},disabled:{type:'boolean',defaultValue:false,input:false}},
    deleteUser:{enabled:true,beforeDelete:async user=>{const current=await db.user.findUnique({where:{id:user.id}});if(current?.role==='admin')throw new APIError('FORBIDDEN',{message:'Administrator deletion requires offline maintenance'});}}},
  databaseHooks:{session:{create:{before:async session=>{
    const user=await db.user.findUnique({where:{id:session.userId}});
    if(!user||user.disabled||!user.username)throw new APIError('UNAUTHORIZED',{message:'Invalid username or password'});
    return {data:session};
  }}}},
  session:{expiresIn:60*60*24*7,updateAge:60*60*12,storeSessionInDatabase:true,cookieCache:{enabled:false}},
  // Credentials are created offline. Email is retained only for legacy schema compatibility.
  // The HTTP dispatcher denies every email/profile/recovery route, not just registration UI.
  emailAndPassword:{enabled:true,disableSignUp:true,minPasswordLength:12,maxPasswordLength:128,requireEmailVerification:false},
  advanced:{useSecureCookies:config.SECURE_COOKIES,cookiePrefix:config.COOKIE_PREFIX,defaultCookieAttributes:{secure:config.SECURE_COOKIES,httpOnly:true,sameSite:'lax',path:'/'},
    ipAddress:{ipAddressHeaders:['x-real-ip']}},
  rateLimit:{enabled:true,storage:'secondary-storage',window:60,max:30,
    customRules:{'/sign-in/username':{window:60,max:5}}},
  plugins:[username({displayUsername:false,immutableUsername:true,minUsernameLength:3,maxUsernameLength:32,
    usernameValidator:value=>/^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/.test(value.trim()),
    usernameNormalization:value=>value.trim().toLowerCase()}),twoFactor({issuer:'照见 Star Oracle'})],
});
