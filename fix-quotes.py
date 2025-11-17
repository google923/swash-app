import codecs

# Read the file
with codecs.open(r'c:\Users\chris\OneDrive\Desktop\Swash-app(rebuild)\rep\add-new-customer.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace curly quotes with straight quotes
content = content.replace('\u201c', '"')  # Left double quote
content = content.replace('\u201d', '"')  # Right double quote
content = content.replace('\u2018', "'")  # Left single quote
content = content.replace('\u2019', "'")  # Right single quote

# Write back
with codecs.open(r'c:\Users\chris\OneDrive\Desktop\Swash-app(rebuild)\rep\add-new-customer.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Converted all curly quotes to straight quotes!")
