import requests
h={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36','Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','Accept-Language':'uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7','Accept-Encoding':'gzip, deflate, br','Referer':'https://www.google.com/','Connection':'keep-alive','Upgrade-Insecure-Requests':'1'}
r=requests.get('https://concert.ua/uk/catalog/all-cities/humor', timeout=30, headers=h)
print('concert.ua', r.status_code)
r2=requests.get('https://lviv.kontramarka.ua/uk/standUp', timeout=30, headers=h)
print('kontramarka', r2.status_code)
