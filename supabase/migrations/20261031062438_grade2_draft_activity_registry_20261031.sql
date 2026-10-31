begin;
insert into private.g2_activities(slug,title,chapter,mode,status) values
('g2-azhar-ch01-learn','ورشة التعلّم — القياس الفيزيائي',1,'learn','draft'),
('g2-azhar-ch01-mastery','تدريبات الإتقان — القياس الفيزيائي',1,'mastery','draft'),
('g2-azhar-ch02-learn','ورشة التعلّم — الحركة في خط مستقيم',2,'learn','draft'),
('g2-azhar-ch02-mastery','تدريبات الإتقان — الحركة في خط مستقيم',2,'mastery','draft'),
('g2-azhar-ch03-learn','ورشة التعلّم — القوة والحركة',3,'learn','draft'),
('g2-azhar-ch03-mastery','تدريبات الإتقان — القوة والحركة',3,'mastery','draft')
on conflict (slug) do nothing;
commit;