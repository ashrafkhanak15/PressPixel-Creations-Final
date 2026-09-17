import { z } from 'zod';
import { services } from './content';
export const enquirySchema=z.object({
 id:z.string().uuid(),
 name:z.string().trim().min(2,'Please enter your name.').max(120),
 email:z.string().trim().email('Please enter a valid email address.').max(254).transform(s=>s.toLowerCase()),
 company:z.string().trim().max(160).default(''),
 website:z.string().trim().max(500).default(''),
 services:z.array(z.string()).max(services.length).refine(items=>items.every(s=>services.some(option=>option.name===s)),'Choose a listed service.'),
 message:z.string().trim().min(15,'Tell us a little more about your project (at least 15 characters).').max(5000),
 consent:z.literal(true,{errorMap:()=>({message:'Please agree to the privacy policy.'})}),
 companyFax:z.string().max(500).default('')
});
