import { PipeTransform, BadRequestException } from '@nestjs/common';
import type { ZodType } from 'zod';
export class SchemaPipe implements PipeTransform {
 constructor(private readonly schema:ZodType) {}
 transform(value:unknown) {
   const result=this.schema.safeParse(value);
   if(!result.success) throw new BadRequestException('请求格式不正确');
   return result.data;
 }
}
